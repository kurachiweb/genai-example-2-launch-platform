import { afterEach, describe, expect, test, vi } from 'vitest';

import type { HttpFetch } from '../../../lib/workers/bot-protection/turnstile-verifier.ts';
import {
  HIBP_RANGE_URL,
  HibpPwnedPasswordChecker,
  type HibpPwnedPasswordCheckerOptions,
} from './hibp-pwned-password-checker.ts';

interface RangeCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly signal: AbortSignal | null | undefined;
}

interface FakeFetch {
  readonly fetch: HttpFetch;
  readonly calls: RangeCall[];
}

const USER_AGENT = 'example-service-api';

// HIBPの文書が例に挙げる、SHA-1の先頭5文字が5BAA6になるパスワード
const KNOWN_PASSWORD = ['pass', 'word'].join('');

const KNOWN_PREFIX = '5BAA6';

const OTHER_SUFFIXES = [
  '0018A45C4D1DEF81644B54AB7F969B88D65',
  '00D4F6E8FA6EECAD2A3AA415EEC418D38EC',
  '011053FD0102E94D6AE2F8B83D76FAF94F6',
] as const;

async function sha1Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-1',
    new TextEncoder().encode(text),
  );
  return new Uint8Array(digest).toHex().toUpperCase();
}

async function suffixOf(password: string): Promise<string> {
  return (await sha1Hex(password)).slice(5);
}

function createFakeFetch(
  respond: (init: RequestInit | undefined) => Promise<Response>,
): FakeFetch {
  const calls: RangeCall[] = [];
  const fakeFetch: HttpFetch = (input, init) => {
    const request = new Request(input, init);
    calls.push({
      url: request.url,
      method: request.method,
      headers: request.headers,
      signal: init?.signal,
    });
    return respond(init);
  };
  return { fetch: fakeFetch, calls };
}

function respondWith(body: string, status = 200): FakeFetch {
  return createFakeFetch(() =>
    Promise.resolve(
      new Response(body, {
        status,
        headers: { 'Content-Type': 'text/plain' },
      }),
    ),
  );
}

// 打ち切りの合図が来るまで応答しない照合サービスの代わり
function respondOnlyWhenAborted(): FakeFetch {
  return createFakeFetch(
    (init) =>
      new Promise<Response>((_, reject) => {
        const signal = init?.signal;
        if (signal === null || signal === undefined) {
          reject(new Error('打ち切りの合図が渡されていません'));
          return;
        }
        signal.addEventListener('abort', () => {
          reject(signal.reason as Error);
        });
      }),
  );
}

function rangeBody(lines: readonly string[]): string {
  return `${lines.join('\r\n')}\r\n`;
}

function checker(
  fake: FakeFetch,
  overrides: Partial<HibpPwnedPasswordCheckerOptions> = {},
): HibpPwnedPasswordChecker {
  return new HibpPwnedPasswordChecker({
    fetch: fake.fetch,
    userAgent: USER_AGENT,
    ...overrides,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('HibpPwnedPasswordChecker(要求)', () => {
  test('SHA-1の16進(大文字)の先頭5文字だけをrange APIへGETで送る', async () => {
    const fake = respondWith(rangeBody(OTHER_SUFFIXES.map((s) => `${s}:1`)));

    await checker(fake).check(KNOWN_PASSWORD);

    expect(HIBP_RANGE_URL).toBe('https://api.pwnedpasswords.com/range/');
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.method).toBe('GET');
    expect(fake.calls[0]?.url).toBe(
      `https://api.pwnedpasswords.com/range/${KNOWN_PREFIX}`,
    );
  });

  test('パディングの指定と識別用のUser-Agentを付ける', async () => {
    const fake = respondWith(rangeBody(OTHER_SUFFIXES.map((s) => `${s}:1`)));

    await checker(fake).check(KNOWN_PASSWORD);

    expect(fake.calls[0]?.headers.get('Add-Padding')).toBe('true');
    expect(fake.calls[0]?.headers.get('User-Agent')).toBe(USER_AGENT);
  });

  test('パスワードとハッシュの残りの部分を、URLにもヘッダーにも含めない', async () => {
    const fake = respondWith(rangeBody(OTHER_SUFFIXES.map((s) => `${s}:1`)));
    const password = ['correct', 'horse', 'battery', 'staple'].join(' ');
    const fullHash = await sha1Hex(password);

    await checker(fake).check(password);

    const call = fake.calls[0];
    const sent = [
      call?.url ?? '',
      ...[...(call?.headers.entries() ?? [])].flat(),
    ].join('\n');
    expect(call?.url).toBe(`${HIBP_RANGE_URL}${fullHash.slice(0, 5)}`);
    expect(sent).not.toContain(fullHash.slice(5));
    expect(sent.toUpperCase()).not.toContain(fullHash.slice(5));
    expect(sent).not.toContain(password);
    expect(sent).not.toContain(encodeURIComponent(password));
  });

  test('UTF-8の文字列としてハッシュを計算する', async () => {
    const fake = respondWith(rangeBody(OTHER_SUFFIXES.map((s) => `${s}:1`)));
    const password = ['パスワード', 'の', '例'].join('');

    await checker(fake).check(password);

    expect(fake.calls[0]?.url).toBe(
      `${HIBP_RANGE_URL}${(await sha1Hex(password)).slice(0, 5)}`,
    );
  });

  test('既定では3秒で通信を打ち切る', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fake = respondWith(rangeBody(OTHER_SUFFIXES.map((s) => `${s}:1`)));

    await checker(fake).check(KNOWN_PASSWORD);

    expect(timeout).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledWith(3000);
    expect(fake.calls[0]?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('HibpPwnedPasswordChecker(照合の結果)', () => {
  test('残り35文字が一致し出現回数が1以上の行があれば漏洩済みとする', async () => {
    const suffix = await suffixOf(KNOWN_PASSWORD);
    const fake = respondWith(
      rangeBody([`${OTHER_SUFFIXES[0]}:3`, `${suffix}:52256179`]),
    );

    const result = await checker(fake).check(KNOWN_PASSWORD);

    expect(result).toStrictEqual({ kind: 'pwned' });
  });

  test('一致する行が無ければ漏洩していないとする', async () => {
    const fake = respondWith(rangeBody(OTHER_SUFFIXES.map((s) => `${s}:12`)));

    const result = await checker(fake).check(KNOWN_PASSWORD);

    expect(result).toStrictEqual({ kind: 'not-pwned' });
  });

  test('出現回数0のパディングの行は、残り35文字が一致しても無視する', async () => {
    const suffix = await suffixOf(KNOWN_PASSWORD);
    const fake = respondWith(
      rangeBody([
        `${OTHER_SUFFIXES[0]}:0`,
        `${suffix}:0`,
        `${OTHER_SUFFIXES[1]}:7`,
      ]),
    );

    const result = await checker(fake).check(KNOWN_PASSWORD);

    expect(result).toStrictEqual({ kind: 'not-pwned' });
  });

  test('改行がLFだけで末尾の改行が無い応答も解釈する', async () => {
    const suffix = await suffixOf(KNOWN_PASSWORD);
    const fake = respondWith(
      [`${OTHER_SUFFIXES[0]}:1`, `${suffix}:2`].join('\n'),
    );

    const result = await checker(fake).check(KNOWN_PASSWORD);

    expect(result).toStrictEqual({ kind: 'pwned' });
  });

  test('小文字の16進の行も大文字と同じに照合する', async () => {
    const suffix = await suffixOf(KNOWN_PASSWORD);
    const fake = respondWith(rangeBody([`${suffix.toLowerCase()}:4`]));

    const result = await checker(fake).check(KNOWN_PASSWORD);

    expect(result).toStrictEqual({ kind: 'pwned' });
  });
});

describe('HibpPwnedPasswordChecker(照合できないとき)', () => {
  test.each([400, 403, 404, 429, 500, 503])(
    '状態コード%iなら、状態コードを理由に照合できないとする',
    async (status) => {
      const suffix = await suffixOf(KNOWN_PASSWORD);
      const fake = respondWith(rangeBody([`${suffix}:1`]), status);

      const result = await checker(fake).check(KNOWN_PASSWORD);

      expect(result).toStrictEqual({ kind: 'unavailable', reason: 'status' });
    },
  );

  test('2xx以外の応答は、本文を読めなくても状態コードを理由に照合できないとする', async () => {
    const brokenBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new TypeError('Network connection lost.'));
      },
    });
    const fake = createFakeFetch(() =>
      Promise.resolve(new Response(brokenBody, { status: 503 })),
    );

    const result = await checker(fake).check(KNOWN_PASSWORD);

    expect(result).toStrictEqual({ kind: 'unavailable', reason: 'status' });
  });

  test('通信に失敗したら、例外を投げずに通信の失敗を理由に照合できないとする', async () => {
    const fake = createFakeFetch(() =>
      Promise.reject(new TypeError('Network connection lost.')),
    );

    const result = await checker(fake).check(KNOWN_PASSWORD);

    expect(result).toStrictEqual({ kind: 'unavailable', reason: 'network' });
  });

  test('fetchが同期的に例外を投げても、通信の失敗として扱う', async () => {
    const fake: FakeFetch = {
      fetch: () => {
        throw new TypeError('Invalid URL');
      },
      calls: [],
    };

    const result = await checker(fake).check(KNOWN_PASSWORD);

    expect(result).toStrictEqual({ kind: 'unavailable', reason: 'network' });
  });

  test('打ち切りの時間を過ぎたら、時間切れを理由に照合できないとする', async () => {
    const fake = respondOnlyWhenAborted();

    const result = await checker(fake, { timeoutMs: 10 }).check(KNOWN_PASSWORD);

    expect(result).toStrictEqual({ kind: 'unavailable', reason: 'timeout' });
  });

  test.each([
    { label: '空の本文', body: '' },
    { label: '改行だけの本文', body: '\r\n\r\n' },
    {
      label: 'HTMLの本文',
      body: '<!DOCTYPE html><html><body>Error</body></html>',
    },
    { label: 'JSONの本文', body: '{"message":"error"}' },
    {
      label: '34文字の行',
      body: rangeBody([`${OTHER_SUFFIXES[0].slice(1)}:1`]),
    },
    {
      label: '36文字の行',
      body: rangeBody([`${OTHER_SUFFIXES[0]}0:1`]),
    },
    { label: '出現回数の無い行', body: rangeBody([OTHER_SUFFIXES[0]]) },
    { label: '出現回数が空の行', body: rangeBody([`${OTHER_SUFFIXES[0]}:`]) },
    { label: '負の出現回数の行', body: rangeBody([`${OTHER_SUFFIXES[0]}:-1`]) },
    {
      label: '16進でない文字を含む行',
      body: rangeBody([`${'G'.repeat(35)}:1`]),
    },
    {
      label: '形式の正しい行と正しくない行が混ざった本文',
      body: rangeBody([`${OTHER_SUFFIXES[0]}:1`, 'unexpected']),
    },
  ])(
    '$labelなら、応答の形式の違反を理由に照合できないとする',
    async ({ body }) => {
      const fake = respondWith(body);

      const result = await checker(fake).check(KNOWN_PASSWORD);

      expect(result).toStrictEqual({
        kind: 'unavailable',
        reason: 'invalid-response',
      });
    },
  );

  test('形式の違反の行があれば、一致する行があっても漏洩済みと判断しない', async () => {
    const suffix = await suffixOf(KNOWN_PASSWORD);
    const fake = respondWith(rangeBody([`${suffix}:9`, 'unexpected']));

    const result = await checker(fake).check(KNOWN_PASSWORD);

    expect(result).toStrictEqual({
      kind: 'unavailable',
      reason: 'invalid-response',
    });
  });
});
