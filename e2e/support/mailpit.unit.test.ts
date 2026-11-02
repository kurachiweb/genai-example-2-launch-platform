import { afterEach, describe, expect, test } from 'bun:test';

import {
  extractLinks,
  resolveMailpitOrigin,
  waitForEmailLink,
  waitForEmailWithSubject,
  waitForLatestEmail,
} from './mailpit.ts';

type TestServer = ReturnType<typeof Bun.serve>;

interface FakeMessage {
  readonly id: string;
  readonly to: readonly string[];
  readonly subject: string;
  readonly created: string;
  readonly text: string;
}

interface FakeMailpit {
  readonly origin: string;
  readonly searchQueries: readonly string[];
  deliver(message: FakeMessage): void;
}

const startedServers: TestServer[] = [];

afterEach(async () => {
  await Promise.all(startedServers.splice(0).map((server) => server.stop()));
});

const rejectionOf = async (promise: Promise<unknown>): Promise<Error> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
    throw error;
  }
  throw new Error('失敗するはずの処理が成功しました');
};

const toSummary = (message: FakeMessage) => ({
  ID: message.id,
  To: message.to.map((address) => ({ Name: '', Address: address })),
  Subject: message.subject,
  Created: message.created,
});

const startFakeMailpit = (
  initial: readonly FakeMessage[] = [],
): FakeMailpit => {
  const messages: FakeMessage[] = [...initial];
  const searchQueries: string[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) => {
      const url = new URL(request.url);
      if (url.pathname === '/api/v1/search') {
        searchQueries.push(url.searchParams.get('query') ?? '');
        const newestFirst = messages.toSorted((left, right) =>
          right.created.localeCompare(left.created),
        );
        return Response.json({ messages: newestFirst.map(toSummary) });
      }
      const id = /^\/api\/v1\/message\/(?<id>[^/]+)$/u.exec(url.pathname)
        ?.groups?.id;
      const message = messages.find((candidate) => candidate.id === id);
      if (message === undefined) {
        return new Response('not found', { status: 404 });
      }
      return Response.json({
        ...toSummary(message),
        Text: message.text,
        HTML: `<p>${message.text}</p>`,
      });
    },
  });
  startedServers.push(server);
  return {
    origin: `http://127.0.0.1:${String(server.port)}`,
    searchQueries,
    deliver: (message) => {
      messages.push(message);
    },
  };
};

const RECIPIENT = 'e2e-recipient@test.example';

const VERIFY_LINK = 'http://localhost:48044/auth/verify-email#token=first';

const verificationMessage = (
  overrides: Partial<FakeMessage> = {},
): FakeMessage => ({
  id: 'verification',
  to: [RECIPIENT],
  subject: 'メールアドレスを確認してください',
  created: '2026-11-02T10:00:00.000Z',
  text: `ご登録ありがとうございます。\n\nメールアドレスを確認する ${VERIFY_LINK}\n`,
  ...overrides,
});

describe('resolveMailpitOrigin', () => {
  test('環境変数が無ければローカルのMailpitのオリジンを使う', () => {
    expect(resolveMailpitOrigin({})).toBe('http://localhost:48041');
  });

  test('空文字は未設定と同じく既定のオリジンを使う', () => {
    expect(resolveMailpitOrigin({ E2E_MAILPIT_URL: '' })).toBe(
      'http://localhost:48041',
    );
  });

  test('環境変数で上書きできる', () => {
    expect(
      resolveMailpitOrigin({ E2E_MAILPIT_URL: 'http://mailpit.example:8025' }),
    ).toBe('http://mailpit.example:8025');
  });
});

describe('extractLinks', () => {
  test('本文のhttpとhttpsのURLを出現順に抜き出し、フラグメントを残す', () => {
    const text = [
      'メールアドレスを確認する http://localhost:48044/auth/verify-email#token=abc_DEF-123',
      'お問い合わせ https://app.example/contact',
    ].join('\n');

    expect(extractLinks(text)).toEqual([
      'http://localhost:48044/auth/verify-email#token=abc_DEF-123',
      'https://app.example/contact',
    ]);
  });

  test('URLの直後の括弧や山括弧を含めない', () => {
    expect(
      extractLinks('(https://app.example/a) <https://app.example/b>'),
    ).toEqual(['https://app.example/a', 'https://app.example/b']);
  });

  test('URLが無ければ空の配列を返す', () => {
    expect(extractLinks('リンクはありません。')).toEqual([]);
  });
});

describe('waitForLatestEmail', () => {
  test('宛先で検索し、最新のメールの件名と本文とリンクを返す', async () => {
    const mailpit = startFakeMailpit([
      verificationMessage({ id: 'older', created: '2026-11-02T09:00:00.000Z' }),
      verificationMessage({ id: 'newer', subject: '新しい方' }),
    ]);

    const message = await waitForLatestEmail(
      { to: RECIPIENT },
      { origin: mailpit.origin },
    );

    expect(message.id).toBe('newer');
    expect(message.subject).toBe('新しい方');
    expect(message.receivedAt).toEqual(new Date('2026-11-02T10:00:00.000Z'));
    expect(message.links).toEqual([VERIFY_LINK]);
    expect(mailpit.searchQueries[0]).toBe(`to:"${RECIPIENT}"`);
  });

  test('検索に部分一致した別の宛先のメールを返さない', async () => {
    const mailpit = startFakeMailpit([
      verificationMessage({
        id: 'other',
        to: [`x${RECIPIENT}`],
        created: '2026-11-02T11:00:00.000Z',
      }),
      verificationMessage({ id: 'mine' }),
    ]);

    const message = await waitForLatestEmail(
      { to: RECIPIENT.toUpperCase() },
      { origin: mailpit.origin },
    );

    expect(message.id).toBe('mine');
  });

  test('指定の時刻より前に届いたメールを除く', async () => {
    const mailpit = startFakeMailpit([verificationMessage({ id: 'old' })]);

    const waiting = waitForLatestEmail(
      { to: RECIPIENT, receivedAfter: new Date('2026-11-02T10:00:00.000Z') },
      { origin: mailpit.origin, intervalMs: 10, timeoutMs: 2_000 },
    );
    mailpit.deliver(
      verificationMessage({ id: 'new', created: '2026-11-02T10:00:01.000Z' }),
    );

    expect((await waiting).id).toBe('new');
  });

  test('まだ届いていなければ、届くまで検索し直す', async () => {
    const mailpit = startFakeMailpit();

    const waiting = waitForLatestEmail(
      { to: RECIPIENT },
      { origin: mailpit.origin, intervalMs: 10, timeoutMs: 2_000 },
    );
    await Bun.sleep(50);
    mailpit.deliver(verificationMessage());

    expect((await waiting).id).toBe('verification');
    expect(mailpit.searchQueries.length).toBeGreaterThan(1);
  });

  test('期限までに届かなければ、宛先と待った時間を示して失敗する', async () => {
    const mailpit = startFakeMailpit();

    const error = await rejectionOf(
      waitForLatestEmail(
        { to: RECIPIENT },
        { origin: mailpit.origin, intervalMs: 10, timeoutMs: 100 },
      ),
    );

    expect(error.message).toContain(
      `${RECIPIENT}へのメールが100ミリ秒以内に届きませんでした`,
    );
  });

  test('Mailpitが失敗を返したら、状態コードを示して失敗する', async () => {
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () => new Response('error', { status: 500 }),
    });
    startedServers.push(server);

    const error = await rejectionOf(
      waitForLatestEmail(
        { to: RECIPIENT },
        { origin: `http://127.0.0.1:${String(server.port)}`, timeoutMs: 100 },
      ),
    );

    expect(error.message).toContain(
      'Mailpitの要求が失敗しました: 状態コード500',
    );
  });
});

describe('waitForEmailLink', () => {
  test('指定の経路へのリンクを含む最新のメールから、そのリンクを返す', async () => {
    const mailpit = startFakeMailpit([
      verificationMessage(),
      {
        id: 'notice',
        to: [RECIPIENT],
        subject: 'お知らせ',
        created: '2026-11-02T12:00:00.000Z',
        text: 'お問い合わせ https://app.example/contact',
      },
    ]);

    const link = await waitForEmailLink(
      { to: RECIPIENT, linkPath: '/auth/verify-email' },
      { origin: mailpit.origin },
    );

    expect(link).toBe(VERIFY_LINK);
  });

  test('経路の前方一致では選ばない', async () => {
    const mailpit = startFakeMailpit([
      verificationMessage({
        id: 'longer-path',
        created: '2026-11-02T12:00:00.000Z',
        text: 'http://localhost:48044/auth/verify-email-other#token=x',
      }),
      verificationMessage(),
    ]);

    const link = await waitForEmailLink(
      { to: RECIPIENT, linkPath: '/auth/verify-email' },
      { origin: mailpit.origin },
    );

    expect(link).toBe(VERIFY_LINK);
  });

  test('指定の経路へのリンクを含むメールが届くまで待つ', async () => {
    const mailpit = startFakeMailpit([
      {
        id: 'notice',
        to: [RECIPIENT],
        subject: 'お知らせ',
        created: '2026-11-02T09:00:00.000Z',
        text: 'https://app.example/contact',
      },
    ]);

    const waiting = waitForEmailLink(
      { to: RECIPIENT, linkPath: '/auth/verify-email' },
      { origin: mailpit.origin, intervalMs: 10, timeoutMs: 2_000 },
    );
    await Bun.sleep(50);
    mailpit.deliver(verificationMessage());

    expect(await waiting).toBe(VERIFY_LINK);
  });

  test('期限までに届かなければ、宛先と経路を示して失敗する', async () => {
    const mailpit = startFakeMailpit([
      {
        id: 'notice',
        to: [RECIPIENT],
        subject: 'お知らせ',
        created: '2026-11-02T09:00:00.000Z',
        text: 'https://app.example/contact',
      },
    ]);

    const error = await rejectionOf(
      waitForEmailLink(
        { to: RECIPIENT, linkPath: '/auth/verify-email' },
        { origin: mailpit.origin, intervalMs: 10, timeoutMs: 100 },
      ),
    );

    expect(error.message).toContain(
      `${RECIPIENT}へ/auth/verify-emailのリンクを含むメールが100ミリ秒以内に届きませんでした`,
    );
  });
});

describe('waitForEmailWithSubject', () => {
  test('件名が一致する最新のメールを、後に届いた別の件名のメールより優先して返す', async () => {
    const mailpit = startFakeMailpit([
      verificationMessage({ id: 'completed', subject: '完了しました' }),
      verificationMessage({
        id: 'later',
        created: '2026-11-02T10:00:01.000Z',
      }),
    ]);

    const message = await waitForEmailWithSubject(
      { to: RECIPIENT, subject: '完了しました' },
      { origin: mailpit.origin, intervalMs: 10, timeoutMs: 2_000 },
    );

    expect(message.id).toBe('completed');
  });

  test('件名が一致するメールが届くまで待つ', async () => {
    const mailpit = startFakeMailpit([verificationMessage()]);

    const waiting = waitForEmailWithSubject(
      { to: RECIPIENT, subject: '完了しました' },
      { origin: mailpit.origin, intervalMs: 10, timeoutMs: 2_000 },
    );
    await Bun.sleep(50);
    mailpit.deliver(
      verificationMessage({
        id: 'completed',
        subject: '完了しました',
        created: '2026-11-02T10:00:01.000Z',
      }),
    );

    expect((await waiting).id).toBe('completed');
  });

  test('期限までに届かなければ、宛先と件名を示して失敗する', async () => {
    const mailpit = startFakeMailpit([verificationMessage()]);

    const error = await rejectionOf(
      waitForEmailWithSubject(
        { to: RECIPIENT, subject: '完了しました' },
        { origin: mailpit.origin, intervalMs: 10, timeoutMs: 100 },
      ),
    );

    expect(error.message).toContain(
      `${RECIPIENT}へ件名「完了しました」のメールが100ミリ秒以内に届きませんでした`,
    );
  });
});
