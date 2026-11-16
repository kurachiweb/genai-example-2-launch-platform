import { describe, expect, test } from 'bun:test';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import type {
  CommentRow,
  CommentThreadPage,
  CommentThreadPageInput,
  CommentThreadQuery,
} from '../../../lib/core/engagement/ports.ts';
import type { LaunchRecord } from '../../../lib/core/product/ports.ts';
import { StoreCommentReader } from './comment-reader.ts';
import {
  decodeCommentThreadCursor,
  encodeCommentThreadCursor,
} from './comment-thread-cursor.ts';
import { DirectoryEngagementTargetResolver } from './engagement-target-resolver.ts';
import {
  commentRecordOf,
  createFakeCommentStore,
  currentUserOf,
} from './testing/comment-fakes.ts';
import {
  activeState,
  createFakeTargetDirectory,
  type FakeProductState,
  LAUNCH_ID,
  launchOf,
  MEMBER_ID,
  NOW,
  OTHER_LAUNCH_ID,
  OTHER_PRODUCT_ID,
  OWNER_ID,
  PRODUCT_ID,
  summaryOf,
} from './testing/target-fakes.ts';

const ROOT_A = '01JD0CMNT00000000000000011';
const ROOT_B = '01JD0CMNT00000000000000012';
const REPLY_A = '01JD0CMNT00000000000000021';
const THIRD_LAUNCH_ID = '01JD01NCH00000000000000003';
const CANCELED_LAUNCH_ID = '01JD01NCH00000000000000004';
const STRANGER_ID = '01JD0USER00000000000000003';

const ROOT_A_AT = new Date('2026-11-20T03:10:00.000Z');
const ROOT_B_AT = new Date('2026-11-20T03:00:00.000Z');

const shownRow = (
  commentId: string,
  overrides: Partial<Extract<CommentRow, { kind: 'shown' }>> = {},
): CommentRow => ({
  kind: 'shown',
  commentId,
  parentId: null,
  depth: 1,
  authorUserId: MEMBER_ID,
  bodyMarkdown: `本文${commentId}`,
  createdAt: ROOT_A_AT,
  edited: false,
  ...overrides,
});

const removedRow = (commentId: string): CommentRow => ({
  kind: 'removed',
  commentId,
  parentId: null,
  depth: 1,
});

const TWO_THREADS: CommentThreadPage = {
  threads: [
    {
      root: shownRow(ROOT_A, { authorUserId: OWNER_ID, edited: true }),
      replies: [
        shownRow(REPLY_A, {
          parentId: ROOT_A,
          depth: 2,
          authorUserId: MEMBER_ID,
          createdAt: new Date('2026-11-20T03:20:00.000Z'),
        }),
      ],
    },
    {
      root: shownRow(ROOT_B, {
        authorUserId: STRANGER_ID,
        createdAt: ROOT_B_AT,
      }),
      replies: [],
    },
  ],
  hasNextPage: true,
};

interface FakeThreadQuery {
  readonly query: CommentThreadQuery;
  readonly pageReads: CommentThreadPageInput[];
  readonly countReads: string[];
}

function createFakeThreadQuery(
  input: {
    readonly page?: CommentThreadPage;
    readonly counts?: ReadonlyMap<string, number>;
  } = {},
): FakeThreadQuery {
  const pageReads: CommentThreadPageInput[] = [];
  const countReads: string[] = [];
  return {
    pageReads,
    countReads,
    query: {
      page(pageInput) {
        pageReads.push(pageInput);
        return Promise.resolve(
          input.page ?? { threads: [], hasNextPage: false },
        );
      },
      countsByLaunch(productId) {
        countReads.push(productId);
        return Promise.resolve(input.counts ?? new Map());
      },
      countsByProduct() {
        throw new Error('この偽物では使わない: countsByProduct');
      },
    },
  };
}

const LAUNCHES: readonly LaunchRecord[] = [
  launchOf({ launchId: THIRD_LAUNCH_ID, number: 3, status: 'scheduled' }),
  launchOf({ launchId: CANCELED_LAUNCH_ID, number: 0, status: 'canceled' }),
  launchOf({ launchId: OTHER_LAUNCH_ID, number: 2, status: 'finished' }),
  launchOf({ launchId: LAUNCH_ID, number: 1, status: 'finished' }),
  launchOf({
    launchId: '01JD01NCH00000000000000009',
    productId: OTHER_PRODUCT_ID,
  }),
];

function setup(
  input: {
    readonly listed?: boolean;
    readonly state?: Partial<FakeProductState>;
    readonly page?: CommentThreadPage;
    readonly counts?: ReadonlyMap<string, number>;
    readonly records?: Parameters<typeof createFakeCommentStore>[0];
  } = {},
) {
  const directory = createFakeTargetDirectory({
    products: [
      {
        summary: summaryOf({ listed: input.listed ?? true }),
        state: { ...activeState(), ...input.state },
      },
      {
        summary: summaryOf({ productId: OTHER_PRODUCT_ID, handle: 'other' }),
        state: activeState(),
      },
    ],
    launches: LAUNCHES,
  });
  const threadQuery = createFakeThreadQuery(input);
  const store = createFakeCommentStore(input.records);
  const reader = new StoreCommentReader(
    new DirectoryEngagementTargetResolver(directory.directory),
    directory.directory,
    threadQuery.query,
    store.store,
  );
  return { reader, directory, threadQuery, store };
}

const pageInput = (
  overrides: Partial<Parameters<StoreCommentReader['page']>[0]> = {},
): Parameters<StoreCommentReader['page']>[0] => ({
  productId: PRODUCT_ID,
  launchId: LAUNCH_ID,
  viewer: currentUserOf(MEMBER_ID),
  after: undefined,
  now: NOW,
  ...overrides,
});

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  return undefined;
}

describe('StoreCommentReader.page', () => {
  test('閲覧者から見た投稿者本人とあなたの判定を添えてスレッドを返し、最後のトップレベルのコメントのカーソルと続きの有無を返す', async () => {
    const { reader, threadQuery } = setup({ page: TWO_THREADS });

    const result = await reader.page(pageInput());

    expect(threadQuery.pageReads).toEqual([
      { launchId: LAUNCH_ID, after: undefined },
    ]);
    expect(result?.threads).toEqual([
      {
        comment: {
          kind: 'shown',
          id: ROOT_A,
          parentId: null,
          depth: 1,
          authorUserId: OWNER_ID,
          bodyMarkdown: `本文${ROOT_A}`,
          createdAt: ROOT_A_AT,
          edited: true,
          byProductOwner: true,
          viewerIsAuthor: false,
        },
        replies: [
          expect.objectContaining({
            id: REPLY_A,
            parentId: ROOT_A,
            depth: 2,
            byProductOwner: false,
            viewerIsAuthor: true,
          }),
        ],
      },
      expect.anything(),
    ]);
    expect(result?.threads[1]).toMatchObject({
      comment: { id: ROOT_B, byProductOwner: false, viewerIsAuthor: false },
      replies: [],
    });
    expect(result?.hasNextPage).toBe(true);
    expect(result?.endCursor).toBe(
      encodeCommentThreadCursor({
        createdAt: ROOT_B_AT.getTime(),
        commentId: ROOT_B,
      }),
    );
  });

  test('未ログインの閲覧者には、どのコメントにもあなたの判定を付けない', async () => {
    const { reader } = setup({ page: TWO_THREADS });

    const result = await reader.page(pageInput({ viewer: undefined }));

    const views = result?.threads.flatMap(({ comment, replies }) => [
      comment,
      ...replies,
    ]);
    expect(
      views?.map((view) => view.kind === 'shown' && view.viewerIsAuthor),
    ).toEqual([false, false, false]);
  });

  test('受け取ったカーソルを作成日時のミリ秒とIDに戻して照会へ渡す', async () => {
    const { reader, threadQuery } = setup({ page: TWO_THREADS });
    const after = encodeCommentThreadCursor({
      createdAt: ROOT_B_AT.getTime(),
      commentId: ROOT_B,
    });

    await reader.page(pageInput({ after }));

    expect(threadQuery.pageReads).toEqual([
      {
        launchId: LAUNCH_ID,
        after: { createdAt: ROOT_B_AT.getTime(), commentId: ROOT_B },
      },
    ]);
  });

  test('コメントが無ければ空のスレッドとnullのカーソルを返す', async () => {
    const { reader } = setup();

    expect(await reader.page(pageInput())).toEqual({
      threads: [],
      endCursor: null,
      hasNextPage: false,
    });
  });

  test('最後のトップレベルのコメントが置き換え表示なら、コメントの記録の作成日時でカーソルを作る', async () => {
    const removedAt = new Date('2026-11-20T02:00:00.000Z');
    const { reader, store } = setup({
      page: {
        threads: [
          { root: shownRow(ROOT_A), replies: [] },
          { root: removedRow(ROOT_B), replies: [] },
        ],
        hasNextPage: true,
      },
      records: [
        commentRecordOf({
          commentId: ROOT_B,
          rootId: ROOT_B,
          createdAt: removedAt,
          deletedAt: NOW,
        }),
      ],
    });

    const result = await reader.page(pageInput());

    expect(store.reads).toEqual([[ROOT_B]]);
    expect(result?.threads.at(-1)?.comment).toEqual({
      kind: 'removed',
      id: ROOT_B,
      parentId: null,
      depth: 1,
    });
    expect(
      result?.endCursor === null || result?.endCursor === undefined
        ? undefined
        : decodeCommentThreadCursor(result.endCursor),
    ).toEqual({ createdAt: removedAt.getTime(), commentId: ROOT_B });
  });

  test('最後のトップレベルのコメントが表示できればコメントの記録を読まない', async () => {
    const { reader, store } = setup({ page: TWO_THREADS });

    await reader.page(pageInput());

    expect(store.reads).toEqual([]);
  });

  test('置き換え表示の最後のトップレベルのコメントの記録が無ければ、プロダクトの物理削除の後としてnullを返す', async () => {
    const { reader } = setup({
      page: {
        threads: [{ root: removedRow(ROOT_B), replies: [] }],
        hasNextPage: false,
      },
    });

    expect(await reader.page(pageInput())).toBeNull();
  });

  test.each([
    ['非公開化', { hidden: true }],
    ['論理削除', { deleted: true }],
    ['投稿者の停止', { ownerSuspended: true }],
    ['投稿者の退会', { ownerWithdrawn: true }],
  ] as const)('%sのプロダクトはnullを返す', async (_label, state) => {
    const { reader } = setup({ page: TWO_THREADS, state });

    expect(await reader.page(pageInput())).toBeNull();
  });

  test('未掲載のプロダクトは他者と未ログインにnullを返し、投稿者本人にはスレッドを返す', async () => {
    const { reader } = setup({ page: TWO_THREADS, listed: false });

    const member = await reader.page(pageInput());
    const anonymous = await reader.page(pageInput({ viewer: undefined }));
    const owner = await reader.page(
      pageInput({ viewer: currentUserOf(OWNER_ID) }),
    );

    expect(member).toBeNull();
    expect(anonymous).toBeNull();
    expect(owner?.threads).toHaveLength(2);
    expect(owner?.threads[0]?.comment).toMatchObject({
      byProductOwner: true,
      viewerIsAuthor: true,
    });
  });

  test('存在しないプロダクトはnullを返す', async () => {
    const { reader } = setup({ page: TWO_THREADS });

    expect(
      await reader.page(pageInput({ productId: '01JD0PR0D00000000000000099' })),
    ).toBeNull();
  });

  test.each([
    ['別のプロダクトのローンチ', '01JD01NCH00000000000000009'],
    ['取り消されたローンチ', CANCELED_LAUNCH_ID],
    ['存在しないローンチ', '01JD01NCH00000000000000099'],
  ])('%sはnullを返す', async (_label, launchId) => {
    const { reader } = setup({ page: TWO_THREADS });

    expect(await reader.page(pageInput({ launchId }))).toBeNull();
  });

  test('キックオフ前のローンチはコメントの無いページを返す', async () => {
    const { reader } = setup();

    expect(await reader.page(pageInput({ launchId: THIRD_LAUNCH_ID }))).toEqual(
      { threads: [], endCursor: null, hasNextPage: false },
    );
  });

  test('不正なカーソルは何も読まずにinvalid_cursorで拒否する', async () => {
    const { reader, directory, threadQuery } = setup({ page: TWO_THREADS });

    const error = await rejectionOf(reader.page(pageInput({ after: '!!!!' })));

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      kind: 'bad_request',
      code: 'invalid_cursor',
    });
    expect(directory.summaryReads).toEqual([]);
    expect(threadQuery.pageReads).toEqual([]);
  });
});

describe('StoreCommentReader.counts', () => {
  const countsInput = (
    overrides: Partial<Parameters<StoreCommentReader['counts']>[0]> = {},
  ): Parameters<StoreCommentReader['counts']>[0] => ({
    productId: PRODUCT_ID,
    viewer: currentUserOf(MEMBER_ID),
    now: NOW,
    ...overrides,
  });

  test('取消を除くプロダクトの全てのローンチの件数を照会の順に返し、コメントの無いローンチを0で補う', async () => {
    const { reader, directory, threadQuery } = setup({
      counts: new Map([
        [LAUNCH_ID, 3],
        [OTHER_LAUNCH_ID, 1],
      ]),
    });

    const result = await reader.counts(countsInput());

    expect(result).toEqual([
      { launchId: THIRD_LAUNCH_ID, count: 0 },
      { launchId: OTHER_LAUNCH_ID, count: 1 },
      { launchId: LAUNCH_ID, count: 3 },
    ]);
    expect(threadQuery.countReads).toEqual([PRODUCT_ID]);
    expect(directory.launchReads).toEqual([
      { productIds: [PRODUCT_ID], now: NOW },
    ]);
  });

  test('取り消されたローンチや一覧に無いローンチの件数は返さない', async () => {
    const { reader } = setup({
      counts: new Map([
        [CANCELED_LAUNCH_ID, 2],
        ['01JD01NCH00000000000000099', 5],
      ]),
    });

    const result = await reader.counts(countsInput());

    expect(result?.map(({ launchId }) => launchId)).toEqual([
      THIRD_LAUNCH_ID,
      OTHER_LAUNCH_ID,
      LAUNCH_ID,
    ]);
    expect(result?.every(({ count }) => count === 0)).toBe(true);
  });

  test.each([
    ['非公開化', { hidden: true }],
    ['論理削除', { deleted: true }],
    ['投稿者の停止', { ownerSuspended: true }],
  ] as const)('%sのプロダクトはnullを返す', async (_label, state) => {
    const { reader } = setup({ counts: new Map([[LAUNCH_ID, 3]]), state });

    expect(await reader.counts(countsInput())).toBeNull();
  });

  test('未掲載のプロダクトは他者と未ログインにnullを返し、投稿者本人には件数を返す', async () => {
    const { reader } = setup({
      counts: new Map([[LAUNCH_ID, 3]]),
      listed: false,
    });

    expect(await reader.counts(countsInput())).toBeNull();
    expect(await reader.counts(countsInput({ viewer: undefined }))).toBeNull();
    expect(
      await reader.counts(countsInput({ viewer: currentUserOf(OWNER_ID) })),
    ).toContainEqual({ launchId: LAUNCH_ID, count: 3 });
  });

  test('存在しないプロダクトはnullを返す', async () => {
    const { reader } = setup();

    expect(
      await reader.counts(
        countsInput({ productId: '01JD0PR0D00000000000000099' }),
      ),
    ).toBeNull();
  });
});
