import { describe, expect, test } from 'bun:test';

import type { MatchRecord } from '../../../lib/core/match/ports.ts';
import type {
  SupporterListInput,
  SupporterListPage,
  SupporterListReader,
} from '../directory/supporter-list-reader.ts';
import {
  createFakePorts,
  currentResolution,
  type FakeOptions,
  matchOf,
  NOW,
  OPPONENT_ID,
  PRODUCT_HANDLE,
  PRODUCT_ID,
  summaryOf,
} from '../directory/testing/product-page-fakes.ts';
import {
  DirectoryPublicSupporterReader,
  PUBLIC_SUPPORTER_PAGE_SIZE,
} from './public-supporter-reader.ts';

const MATCH_ID = '01JD0MTCH00000000000000001';
const OWN_ENTRY = '01JD0ENTR00000000000000002';
const OPPONENT_ENTRY = '01JD0ENTR00000000000000001';
const UPVOTE_ID = '01JD0VPVT00000000000000001';

// 自分の側が2番目の側でも、そのプロダクトの側を選ぶことを確かめるため、相手を先に置く
const matchWith = (
  overrides: Partial<Parameters<typeof matchOf>[0]> = {},
): MatchRecord =>
  matchOf({
    matchId: MATCH_ID,
    sides: [
      {
        entryId: OPPONENT_ENTRY,
        launchId: 'launch-x',
        productId: OPPONENT_ID,
        result: 'lost',
      },
      {
        entryId: OWN_ENTRY,
        launchId: 'launch-1',
        productId: PRODUCT_ID,
        result: 'won',
      },
    ],
    ...overrides,
  });

const PAGE: SupporterListPage = {
  userIds: ['user-1'],
  supporters: [
    { userId: 'user-1', upvotedAt: new Date('2026-11-05T03:00:00.000Z') },
  ],
  endCursor: { upvotedAt: 1, upvoteId: UPVOTE_ID },
  hasNextPage: true,
};

function setup(
  options: FakeOptions & {
    readonly page?: SupporterListPage | null;
  } = {},
) {
  const ports = createFakePorts({ matches: [matchWith()], ...options });
  const listCalls: SupporterListInput[] = [];
  const supporterList: SupporterListReader = {
    list: (input) => {
      listCalls.push(input);
      return Promise.resolve(options.page === undefined ? PAGE : options.page);
    },
  };
  const reader = new DirectoryPublicSupporterReader(
    ports.products,
    ports.matches,
    supporterList,
  );
  return { reader, calls: ports.calls, listCalls };
}

const list = (
  reader: DirectoryPublicSupporterReader,
  options: {
    readonly handle?: string;
    readonly matchId?: string;
    readonly after?: { readonly upvotedAt: number; readonly upvoteId: string };
  } = {},
) =>
  reader.list({
    productHandle: options.handle ?? PRODUCT_HANDLE,
    matchId: options.matchId ?? MATCH_ID,
    after: options.after,
    now: NOW,
  });

describe('PublicSupporterReader.list: プロダクト', () => {
  test('旧ハンドルは現在のハンドルへの転送を返し、マッチとサポーターを読まない', async () => {
    const { reader, calls, listCalls } = setup({
      resolution: { kind: 'previous', product: summaryOf(PRODUCT_ID) },
    });

    expect(await list(reader, { handle: 'old-handle' })).toEqual({
      kind: 'redirect',
      handle: PRODUCT_HANDLE,
    });
    expect(calls.findMatches).toEqual([]);
    expect(listCalls).toEqual([]);
  });

  test.each([
    ['存在しない', { kind: 'none' } as const],
    ['未掲載の', currentResolution(summaryOf(PRODUCT_ID, { listed: false }))],
    [
      '可視でない',
      currentResolution(
        summaryOf(PRODUCT_ID, { visible: false, listed: false }),
      ),
    ],
  ])(
    '%sプロダクトはproduct-not-foundを返し、マッチとサポーターを読まない',
    async (_label, resolution) => {
      const { reader, calls, listCalls } = setup({ resolution });

      expect(await list(reader)).toEqual({ kind: 'product-not-found' });
      expect(calls.findMatches).toEqual([]);
      expect(listCalls).toEqual([]);
    },
  );

  test('形式に合わないハンドルは照会をせずにproduct-not-foundを返す', async () => {
    const { reader, calls } = setup();

    expect(await list(reader, { handle: 'bad handle' })).toEqual({
      kind: 'product-not-found',
    });
    expect(calls.resolveHandle).toEqual([]);
  });
});

describe('PublicSupporterReader.list: マッチ', () => {
  test.each([
    ['存在しない', [] as readonly MatchRecord[]],
    [
      '他のプロダクトの',
      [
        matchWith({
          sides: [
            {
              entryId: OPPONENT_ENTRY,
              launchId: 'launch-x',
              productId: OPPONENT_ID,
            },
            { entryId: OWN_ENTRY, launchId: null, productId: null },
          ],
        }),
      ],
    ],
    ['開催中の', [matchWith({ phase: 'live' })]],
    ['開始前の', [matchWith({ phase: 'scheduled' })]],
  ])(
    '%sマッチはmatch-not-foundを返し、サポーターを読まない',
    async (_label, matches) => {
      const { reader, calls, listCalls } = setup({ matches });

      expect(await list(reader)).toEqual({ kind: 'match-not-found' });
      expect(calls.findMatches).toEqual([{ ids: [MATCH_ID], now: NOW }]);
      expect(listCalls).toEqual([]);
    },
  );

  test('判定の後にサポーターの一覧がnullを返せばmatch-not-foundを返す', async () => {
    const { reader } = setup({ page: null });

    expect(await list(reader)).toEqual({ kind: 'match-not-found' });
  });
});

describe('PublicSupporterReader.list: 一覧', () => {
  test('そのプロダクトの側と現在のハンドルで、未ログインの20件の一覧を求め、ページをそのまま返す', async () => {
    const after = { upvotedAt: 0, upvoteId: UPVOTE_ID };
    const { reader, listCalls } = setup();

    expect(await list(reader, { after })).toEqual({
      kind: 'page',
      supporters: PAGE.supporters,
      hasNextPage: true,
      endCursor: PAGE.endCursor,
    });
    expect(listCalls).toEqual([
      {
        productHandle: PRODUCT_HANDLE,
        matchId: MATCH_ID,
        entryId: OWN_ENTRY,
        viewer: undefined,
        first: PUBLIC_SUPPORTER_PAGE_SIZE,
        after,
        now: NOW,
      },
    ]);
    expect(PUBLIC_SUPPORTER_PAGE_SIZE).toBe(20);
  });

  test('大文字を含むハンドルで引いても、一覧には現在のハンドルを渡す', async () => {
    const { reader, listCalls } = setup();

    await list(reader, { handle: PRODUCT_HANDLE.toUpperCase() });

    expect(listCalls.map(({ productHandle }) => productHandle)).toEqual([
      PRODUCT_HANDLE,
    ]);
  });

  test('空のページは続きの無い空の一覧を返す', async () => {
    const { reader } = setup({
      page: {
        userIds: [],
        supporters: [],
        endCursor: null,
        hasNextPage: false,
      },
    });

    expect(await list(reader)).toEqual({
      kind: 'page',
      supporters: [],
      hasNextPage: false,
      endCursor: null,
    });
  });
});
