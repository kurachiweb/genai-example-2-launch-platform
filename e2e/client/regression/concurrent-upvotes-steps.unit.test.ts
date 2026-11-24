import { describe, expect, test } from 'bun:test';

import type { APIRequestContext } from '@playwright/test';

import {
  ClientQualifierBoardDocument,
  ClientUpvoteDocument,
} from '../../../apps/client/src/graphql/generated/graphql.ts';
import { GRAPHQL_RELAY_PATH } from '../../../apps/frontend-lib/server/relay/relay-contract.ts';
import { documentIdOf } from '../../../apps/frontend-lib/utilities/graphql/persisted-document.ts';
import { BULK_BOT_TOKEN } from '../../support/bot-token.ts';
import {
  entryOfProduct,
  formatUpvoteReport,
  parseQualifierBoardBody,
  parseUpvoteBody,
  readQualifierMatch,
  tallyUpvotes,
  upvoteConcurrently,
  type UpvoteObservation,
} from './concurrent-upvotes-steps.ts';

const TARGET_ENTRY_ID = 'ENTRY-A';

const upvotedBody = (entryId: string): string =>
  JSON.stringify({
    data: { upvote: { id: 'MATCH-1', viewerUpvotedEntryId: entryId } },
  });

const observation = (
  overrides: Partial<UpvoteObservation> = {},
): UpvoteObservation => ({
  status: 200,
  durationMs: 100,
  ...parseUpvoteBody(upvotedBody(TARGET_ENTRY_ID)),
  ...overrides,
});

describe('parseUpvoteBody', () => {
  test('成功の応答からUpvote済みの側の識別子を取り出す', () => {
    expect(parseUpvoteBody(upvotedBody(TARGET_ENTRY_ID))).toEqual({
      errorCodes: [],
      upvotedEntryId: TARGET_ENTRY_ID,
    });
  });

  test('GraphQLのエラーは拡張のコードを集め、コードが無ければ不明とする', () => {
    const body = JSON.stringify({
      errors: [
        { message: 'a', extensions: { code: 'RATE_LIMITED' } },
        { message: 'b' },
      ],
      data: null,
    });

    expect(parseUpvoteBody(body)).toEqual({
      errorCodes: ['RATE_LIMITED', 'UNKNOWN'],
      upvotedEntryId: null,
    });
  });

  test('JSONでない本文は解析できない旨のコードにする', () => {
    expect(parseUpvoteBody('<html>502</html>')).toEqual({
      errorCodes: ['UNPARSEABLE_BODY'],
      upvotedEntryId: null,
    });
  });

  test('dataもerrorsも無い本文は解析できない旨のコードにする', () => {
    expect(parseUpvoteBody('{}')).toEqual({
      errorCodes: ['UNPARSEABLE_BODY'],
      upvotedEntryId: null,
    });
  });
});

describe('tallyUpvotes', () => {
  test('状態コードの内訳と5xxの件数と最大の応答時間を数える', () => {
    const tally = tallyUpvotes(
      [
        observation({ durationMs: 50 }),
        observation({ durationMs: 900 }),
        observation({ status: 503, durationMs: 70 }),
        observation({ status: 429, durationMs: 20 }),
      ],
      TARGET_ENTRY_ID,
    );

    expect(tally.total).toBe(4);
    expect(tally.statusCounts).toEqual({ '200': 2, '429': 1, '503': 1 });
    expect(tally.serverErrorCount).toBe(1);
    expect(tally.maxDurationMs).toBe(900);
  });

  test('成功の応答でUpvote済みの側が対象の側のものだけを受理として数える', () => {
    const tally = tallyUpvotes(
      [
        observation(),
        observation(parseUpvoteBody(upvotedBody('ENTRY-B'))),
        observation({ status: 500 }),
      ],
      TARGET_ENTRY_ID,
    );

    expect(tally.acceptedCount).toBe(1);
  });

  test('GraphQLのエラーのコードごとの件数を数える', () => {
    const failed = observation({
      errorCodes: ['RATE_LIMITED'],
      upvotedEntryId: null,
    });

    const tally = tallyUpvotes(
      [failed, failed, observation()],
      TARGET_ENTRY_ID,
    );

    expect(tally.errorCodeCounts).toEqual({ RATE_LIMITED: 2 });
    expect(tally.acceptedCount).toBe(1);
  });

  test('観測が無ければ件数は全て0になる', () => {
    expect(tallyUpvotes([], TARGET_ENTRY_ID)).toEqual({
      total: 0,
      statusCounts: {},
      serverErrorCount: 0,
      acceptedCount: 0,
      errorCodeCounts: {},
      maxDurationMs: 0,
    });
  });
});

describe('formatUpvoteReport', () => {
  test('所要時間と状態コードの内訳と数え上げを日本語で並べる', () => {
    const tally = tallyUpvotes(
      [observation(), observation({ status: 502 })],
      TARGET_ENTRY_ID,
    );

    const report = formatUpvoteReport(tally, {
      elapsedMs: 1234,
      counts: { target: 1, other: 0 },
    });

    expect(report).toContain('所要時間: 1234ms');
    expect(report).toContain('200: 1件');
    expect(report).toContain('502: 1件');
    expect(report).toContain('5xx: 1件');
    expect(report).toContain('対象の側の数え上げ: 1');
    expect(report).toContain('もう一方の側の数え上げ: 0');
  });
});

const boardBody = JSON.stringify({
  data: {
    qualifierBoard: {
      matches: [
        {
          id: 'MATCH-0',
          entries: [
            { id: 'ENTRY-X', upvoteCount: 3, product: { handle: 'x' } },
          ],
        },
        {
          id: 'MATCH-1',
          entries: [
            { id: 'ENTRY-A', upvoteCount: 100, product: { handle: 'a' } },
            { id: 'ENTRY-B', upvoteCount: 0, product: null },
            { id: 5 },
          ],
        },
      ],
    },
  },
});

describe('parseQualifierBoardBody', () => {
  test('プロダクトの側を含むマッチの識別子と、形の正しい側だけを取り出す', () => {
    expect(parseQualifierBoardBody(boardBody, 'a')).toEqual({
      id: 'MATCH-1',
      entries: [
        { id: 'ENTRY-A', productHandle: 'a', upvoteCount: 100 },
        { id: 'ENTRY-B', productHandle: null, upvoteCount: 0 },
      ],
    });
  });

  test('プロダクトを含むマッチが無ければ未定義を返す', () => {
    expect(parseQualifierBoardBody(boardBody, 'missing')).toBeUndefined();
  });

  test('当日の予選が無い応答は未定義を返す', () => {
    const body = JSON.stringify({ data: { qualifierBoard: null } });

    expect(parseQualifierBoardBody(body, 'a')).toBeUndefined();
  });

  test('JSONでない本文は未定義を返す', () => {
    expect(parseQualifierBoardBody('not json', 'a')).toBeUndefined();
  });
});

interface FakeResponse {
  readonly status: number;
  readonly text: string;
}

interface RecordedPost {
  readonly url: string;
  readonly options: {
    readonly headers: Readonly<Record<string, string>>;
    readonly data: {
      readonly documentId: string;
      readonly variables: unknown;
    };
  };
}

const fakeContext = (
  respond: () => Promise<FakeResponse>,
): { readonly context: APIRequestContext; readonly posts: RecordedPost[] } => {
  const posts: RecordedPost[] = [];
  const context = {
    post: async (url: string, options: RecordedPost['options']) => {
      posts.push({ url, options });
      const { status, text } = await respond();
      return {
        status: () => status,
        ok: () => status >= 200 && status < 300,
        text: () => Promise.resolve(text),
      };
    },
  } as unknown as APIRequestContext;
  return { context, posts };
};

const respondWith = (response: FakeResponse) => () => Promise.resolve(response);

describe('upvoteConcurrently', () => {
  test('全ての文脈からUpvoteの操作をbot判定のトークン付きで中継の経路へ送り、応答ごとの観測を返す', async () => {
    const accepted = fakeContext(
      respondWith({ status: 200, text: upvotedBody(TARGET_ENTRY_ID) }),
    );
    const limited = fakeContext(
      respondWith({
        status: 200,
        text: JSON.stringify({
          errors: [{ extensions: { code: 'RATE_LIMITED' } }],
        }),
      }),
    );

    const { observations, elapsedMs } = await upvoteConcurrently(
      [accepted.context, limited.context],
      { matchId: 'MATCH-1', entryId: TARGET_ENTRY_ID },
    );

    expect(observations).toMatchObject([
      { status: 200, errorCodes: [], upvotedEntryId: TARGET_ENTRY_ID },
      { status: 200, errorCodes: ['RATE_LIMITED'], upvotedEntryId: null },
    ]);
    expect(elapsedMs).toBeGreaterThanOrEqual(0);
    const [post] = accepted.posts;
    expect(post?.url).toBe(GRAPHQL_RELAY_PATH);
    expect(post?.options.headers['cf-turnstile-response']).toBe(BULK_BOT_TOKEN);
    expect(post?.options.data).toEqual({
      documentId: documentIdOf(ClientUpvoteDocument),
      variables: { input: { matchId: 'MATCH-1', entryId: TARGET_ENTRY_ID } },
    });
  });

  test('前の応答を待たずに全ての要求を送り出す', async () => {
    const pending: (() => void)[] = [];
    const respond = () =>
      new Promise<FakeResponse>((resolve) => {
        pending.push(() => {
          resolve({ status: 200, text: upvotedBody(TARGET_ENTRY_ID) });
        });
      });
    const first = fakeContext(respond);
    const second = fakeContext(respond);

    const running = upvoteConcurrently([first.context, second.context], {
      matchId: 'MATCH-1',
      entryId: TARGET_ENTRY_ID,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pending).toHaveLength(2);
    for (const release of pending) release();

    expect((await running).observations).toHaveLength(2);
  });

  test('送信の失敗は例外にせず、状態コード0と通信の失敗のコードの観測にする', async () => {
    const failing = fakeContext(() =>
      Promise.reject(new Error('socket\n  hang up')),
    );

    const { observations } = await upvoteConcurrently([failing.context], {
      matchId: 'MATCH-1',
      entryId: TARGET_ENTRY_ID,
    });

    expect(observations).toMatchObject([
      {
        status: 0,
        errorCodes: ['NETWORK_ERROR: socket hang up'],
        upvotedEntryId: null,
      },
    ]);
  });

  test('長い失敗の説明は160文字までにして観測に残す', async () => {
    const failing = fakeContext(() =>
      Promise.reject(new Error('x'.repeat(200))),
    );

    const { observations } = await upvoteConcurrently([failing.context], {
      matchId: 'MATCH-1',
      entryId: TARGET_ENTRY_ID,
    });

    expect(observations[0]?.errorCodes[0]).toBe(
      `NETWORK_ERROR: ${'x'.repeat(160)}`,
    );
  });
});

describe('readQualifierMatch', () => {
  test('当日の予選の照会を中継の経路へ送り、プロダクトの側を含むマッチを返す', async () => {
    const { context, posts } = fakeContext(
      respondWith({ status: 200, text: boardBody }),
    );

    const match = await readQualifierMatch(context, 'a');

    expect(match.id).toBe('MATCH-1');
    expect(posts[0]?.url).toBe(GRAPHQL_RELAY_PATH);
    expect(posts[0]?.options.data).toEqual({
      documentId: documentIdOf(ClientQualifierBoardDocument),
      variables: {},
    });
  });

  test('プロダクトを含むマッチが無ければ、状態コードと本文を添えて例外にする', async () => {
    const { context } = fakeContext(
      respondWith({ status: 200, text: boardBody }),
    );

    const failure = await readQualifierMatch(context, 'missing').catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain(
      'プロダクトmissingのマッチを取得できません: 状態コード200',
    );
  });

  test('失敗の状態コードの応答は、マッチを含んでも例外にする', async () => {
    const { context } = fakeContext(
      respondWith({ status: 503, text: boardBody }),
    );

    const failure = await readQualifierMatch(context, 'a').catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('状態コード503');
  });
});

describe('entryOfProduct', () => {
  test('プロダクトのハンドルが一致する側を返す', () => {
    const match = parseQualifierBoardBody(boardBody, 'a');

    expect(match && entryOfProduct(match, 'a').id).toBe('ENTRY-A');
  });

  test('一致する側が無ければ例外を投げる', () => {
    const match = { id: 'MATCH-1', entries: [] };

    expect(() => entryOfProduct(match, 'a')).toThrow(
      'プロダクトaの側がありません',
    );
  });
});
