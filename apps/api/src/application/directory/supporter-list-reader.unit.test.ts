import { describe, expect, test } from 'bun:test';

import type { SupporterRecord } from '../../../lib/core/match/ports.ts';
import type { ProductHandleResolution } from '../../../lib/core/product/ports.ts';
import {
  DirectorySupporterListReader,
  type SupporterListPosition,
} from './supporter-list-reader.ts';
import {
  createFakePorts,
  currentResolution,
  type FakeOptions,
  matchOf,
  NOW,
  OPPONENT_ID,
  OWNER_ID,
  PRODUCT_HANDLE,
  PRODUCT_ID,
  STRANGER_ID,
  summaryOf,
  viewerOf,
} from './testing/product-page-fakes.ts';

const MATCH_ID = '01JD0MTCH00000000000000001';
const OWN_ENTRY = '01JD0ENTR00000000000000001';
const OPPONENT_ENTRY = '01JD0ENTR00000000000000002';

const finishedMatch = matchOf({
  matchId: MATCH_ID,
  sides: [
    {
      entryId: OWN_ENTRY,
      launchId: 'launch-1',
      productId: PRODUCT_ID,
      upvoteCount: 3,
      result: 'won',
    },
    {
      entryId: OPPONENT_ENTRY,
      launchId: 'launch-x',
      productId: OPPONENT_ID,
      upvoteCount: 1,
      result: 'lost',
    },
  ],
});

const supporterOf = (index: number): SupporterRecord => ({
  upvoteId: `01JD0UPVT0000000000000${String(index).padStart(4, '0')}`,
  userId: `user-${String(index)}`,
  upvotedAt: new Date(Date.UTC(2026, 10, 5, 0, index)),
});

const supporters = (count: number): readonly SupporterRecord[] =>
  Array.from({ length: count }, (_, index) => supporterOf(index + 1));

function setup(options: FakeOptions = {}) {
  const ports = createFakePorts({ matches: [finishedMatch], ...options });
  const reader = new DirectorySupporterListReader(
    ports.products,
    ports.matches,
    ports.supporters,
  );
  return { reader, calls: ports.calls };
}

const list = (
  reader: DirectorySupporterListReader,
  options: {
    readonly handle?: string;
    readonly matchId?: string;
    readonly entryId?: string;
    readonly viewerId?: string;
    readonly first?: number;
    readonly after?: SupporterListPosition;
  } = {},
) =>
  reader.list({
    productHandle: options.handle ?? PRODUCT_HANDLE,
    matchId: options.matchId ?? MATCH_ID,
    entryId: options.entryId ?? OWN_ENTRY,
    viewer:
      options.viewerId === undefined ? undefined : viewerOf(options.viewerId),
    first: options.first ?? 20,
    after: options.after,
    now: NOW,
  });

describe('SupporterListReader.list: 表示できない場合', () => {
  const NULL_CASES: readonly [
    string,
    ProductHandleResolution,
    string | undefined,
  ][] = [
    ['存在しない', { kind: 'none' }, undefined],
    [
      '可視でない',
      currentResolution(
        summaryOf(PRODUCT_ID, { visible: false, listed: false }),
      ),
      OWNER_ID,
    ],
    [
      '未掲載の他者のプロダクト',
      currentResolution(summaryOf(PRODUCT_ID, { listed: false })),
      STRANGER_ID,
    ],
    [
      '旧ハンドル',
      { kind: 'previous', product: summaryOf(PRODUCT_ID) },
      undefined,
    ],
  ];

  test.each(NULL_CASES)(
    '%sのプロダクトならnullを返し、マッチとサポーターを読まない',
    async (_label, resolution, viewerId) => {
      const { reader, calls } = setup({
        resolution,
        supporters: supporters(1),
      });

      expect(await list(reader, { viewerId })).toBeNull();
      expect(calls.findMatches).toEqual([]);
      expect(calls.listSupporters).toEqual([]);
    },
  );

  test('ハンドルが形式に合わなければ照会をせずにnullを返す', async () => {
    const { reader, calls } = setup();

    expect(await list(reader, { handle: 'bad handle' })).toBeNull();
    expect(calls.resolveHandle).toEqual([]);
  });

  test('対戦相手の側ならnullを返し、サポーターを読まない', async () => {
    const { reader, calls } = setup({ supporters: supporters(1) });

    expect(await list(reader, { entryId: OPPONENT_ENTRY })).toBeNull();
    expect(calls.findMatches).toEqual([{ ids: [MATCH_ID], now: NOW }]);
    expect(calls.listSupporters).toEqual([]);
  });

  test('マッチに無い側ならnullを返す', async () => {
    const { reader, calls } = setup();

    expect(
      await list(reader, { entryId: '01JD0ENTR00000000000000009' }),
    ).toBeNull();
    expect(calls.listSupporters).toEqual([]);
  });

  test('マッチが存在しなければnullを返す', async () => {
    const { reader } = setup({ matches: [] });

    expect(await list(reader)).toBeNull();
  });

  test.each(['scheduled', 'live', 'tallying'] as const)(
    '結果が確定する前(%s)のマッチならnullを返す',
    async (phase) => {
      const { reader, calls } = setup({
        matches: [{ ...finishedMatch, phase, decision: null, decidedAt: null }],
        supporters: supporters(1),
      });

      expect(await list(reader)).toBeNull();
      expect(calls.listSupporters).toEqual([]);
    },
  );
});

describe('SupporterListReader.list: 一覧とカーソル', () => {
  test('本人の未掲載のプロダクトのサポーターを返す', async () => {
    const { reader } = setup({
      resolution: currentResolution(summaryOf(PRODUCT_ID, { listed: false })),
      supporters: supporters(1),
    });

    expect(await list(reader, { viewerId: OWNER_ID })).toEqual({
      userIds: ['user-1'],
      endCursor: {
        upvotedAt: supporterOf(1).upvotedAt.getTime(),
        upvoteId: supporterOf(1).upvoteId,
      },
      hasNextPage: false,
    });
  });

  test('自分の側のサポーターを指定の件数だけUpvoteの日時の順に読み、続きがあればカーソルを返す', async () => {
    const { reader, calls } = setup({ supporters: supporters(21) });

    const page = await list(reader, { first: 20 });

    expect(page?.userIds).toEqual(supporters(20).map(({ userId }) => userId));
    expect(page?.hasNextPage).toBe(true);
    expect(page?.endCursor).toEqual({
      upvotedAt: supporterOf(20).upvotedAt.getTime(),
      upvoteId: supporterOf(20).upvoteId,
    });
    expect(calls.listSupporters[0]).toEqual({
      entryId: OWN_ENTRY,
      after: undefined,
      limit: 20,
    });
  });

  test('カーソルのUpvoteの日時はエポックミリ秒で受け、日時に戻して続きを読む', async () => {
    const { reader, calls } = setup({ supporters: supporters(21) });
    const after: SupporterListPosition = {
      upvotedAt: supporterOf(20).upvotedAt.getTime(),
      upvoteId: supporterOf(20).upvoteId,
    };

    const page = await list(reader, { first: 20, after });

    expect(calls.listSupporters[0]).toEqual({
      entryId: OWN_ENTRY,
      after: {
        upvotedAt: supporterOf(20).upvotedAt,
        upvoteId: supporterOf(20).upvoteId,
      },
      limit: 20,
    });
    expect(page).toEqual({
      userIds: ['user-21'],
      endCursor: {
        upvotedAt: supporterOf(21).upvotedAt.getTime(),
        upvoteId: supporterOf(21).upvoteId,
      },
      hasNextPage: false,
    });
  });

  test('ちょうど指定の件数で終わるなら続きが無い', async () => {
    const { reader, calls } = setup({ supporters: supporters(20) });

    const page = await list(reader, { first: 20 });

    expect(page?.userIds).toHaveLength(20);
    expect(page?.hasNextPage).toBe(false);
    expect(calls.listSupporters.at(-1)).toEqual({
      entryId: OWN_ENTRY,
      after: {
        upvotedAt: supporterOf(20).upvotedAt,
        upvoteId: supporterOf(20).upvoteId,
      },
      limit: 1,
    });
  });

  test('指定の件数に満たなければ続きを確かめずに終わる', async () => {
    const { reader, calls } = setup({ supporters: supporters(3) });

    const page = await list(reader, { first: 5 });

    expect(page?.userIds).toEqual(['user-1', 'user-2', 'user-3']);
    expect(page?.hasNextPage).toBe(false);
    expect(calls.listSupporters).toHaveLength(1);
  });

  test('サポーターがいなければ空の一覧とnullのカーソルを返す', async () => {
    const { reader } = setup({ supporters: [] });

    expect(await list(reader)).toEqual({
      userIds: [],
      endCursor: null,
      hasNextPage: false,
    });
  });
});
