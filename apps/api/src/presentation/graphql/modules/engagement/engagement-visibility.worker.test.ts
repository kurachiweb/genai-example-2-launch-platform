import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { users } from '../../../../../db/schema/identity/users.ts';
import { products } from '../../../../../db/schema/product/products.ts';

import { COMMENT_BOT_ACTIONS } from '../../../../../common-lib/engagement/engagement-rules.ts';
import {
  after,
  commentIdOf,
  countComments,
  db,
  insertComments,
  insertLaunch,
  insertProduct,
  insertRating,
  insertUser,
  launchIdOf,
  productIdOf,
  readComment,
  readRatingsOf,
  T0,
  userIdOf,
} from '../../../../../lib/workers/engagement/testing/engagement-fixtures.ts';
import {
  ENGAGEMENT_ERRORS,
  type EngagementErrorCode,
} from '../../../../application/engagement/engagement-errors.ts';
import {
  cancelProductRating,
  deleteComment,
  fetchLaunchCommentCounts,
  fetchLaunchComments,
  fetchProductRating,
  installEngagementGraphQLTest,
  issueEngagementUserSession,
  postComment,
  rateProduct,
  updateComment,
} from '../../../../../test/support/engagement-graphql-operations.ts';
import {
  botTokenFor,
  type GatewayCallOptions,
  stubExternalServices,
} from '../../../../../test/support/graphql-gateway.ts';
import { codesOf } from '../../../../../test/support/product-graphql-operations.ts';

installEngagementGraphQLTest();

const OWNER = 1;
const COMMENTER = 2;
const VIEWER = 3;

const LISTED = 1;

const WON_LAUNCH = 1;
const CURRENT_LAUNCH = 2;

const TOP = 1;
const OWNER_REPLY = 2;

// プロダクト1は利用者1の掲載中(勝利したローンチ1を持つ)のプロダクトで、当日のローンチ2に利用者2のトップレベル1と投稿者本人の返信2を持つ。利用者2が4、利用者3が2で評価済み
async function seed(): Promise<void> {
  await insertUser(OWNER, { emailVerifiedAt: T0 });
  await insertUser(COMMENTER, { emailVerifiedAt: T0 });
  await insertUser(VIEWER, { emailVerifiedAt: T0 });
  await insertProduct(LISTED, OWNER);
  await insertLaunch(WON_LAUNCH, LISTED, {
    launchDate: '2026-11-05',
    outcome: 'won',
    decidedAt: T0,
  });
  await insertLaunch(CURRENT_LAUNCH, LISTED, { launchDate: '2026-11-10' });
  await insertComments([
    {
      index: TOP,
      product: LISTED,
      launch: CURRENT_LAUNCH,
      author: COMMENTER,
      columns: { createdAt: after(1_000) },
    },
    {
      index: OWNER_REPLY,
      product: LISTED,
      launch: CURRENT_LAUNCH,
      author: OWNER,
      parent: { index: TOP, root: TOP },
      depth: 2,
      columns: { createdAt: after(2_000) },
    },
  ]);
  await insertRating({ index: 1, product: LISTED, user: COMMENTER, score: 4 });
  await insertRating({ index: 2, product: LISTED, user: VIEWER, score: 2 });
}

beforeEach(seed);

async function setProductHidden(hiddenAt: Date | null): Promise<void> {
  await db
    .update(products)
    .set({ hiddenAt })
    .where(eq(products.id, productIdOf(LISTED)));
}

async function setOwnerSuspended(suspended: boolean): Promise<void> {
  await db
    .update(users)
    .set(
      suspended
        ? { status: 'suspended', suspendedAt: T0 }
        : { status: 'active', suspendedAt: null },
    )
    .where(eq(users.id, userIdOf(OWNER)));
}

interface LifecycleState {
  readonly name: string;
  readonly apply: () => Promise<void>;
  readonly revert: () => Promise<void>;
}

const LIFECYCLE_STATES: readonly LifecycleState[] = [
  {
    name: 'プロダクトの非公開化',
    apply: () => setProductHidden(after(60_000)),
    revert: () => setProductHidden(null),
  },
  {
    name: '投稿者の停止',
    apply: () => setOwnerSuspended(true),
    revert: () => setOwnerSuspended(false),
  },
];

type ViewerKind = 'コメントの投稿者' | '評価済みの他者' | '未ログインの閲覧者';

const VIEWER_KINDS: readonly ViewerKind[] = [
  'コメントの投稿者',
  '評価済みの他者',
  '未ログインの閲覧者',
];

async function optionsOf(kind: ViewerKind): Promise<GatewayCallOptions> {
  switch (kind) {
    case 'コメントの投稿者':
      return { sessionToken: await issueEngagementUserSession(COMMENTER) };
    case '評価済みの他者':
      return { sessionToken: await issueEngagementUserSession(VIEWER) };
    case '未ログインの閲覧者':
      return {};
  }
}

// 詳細ページのコメントのスレッド・ローンチごとの件数・評価欄の3つの照会を同じ閲覧者で送る
async function readSections(options: GatewayCallOptions) {
  const [comments, counts, rating] = await Promise.all([
    fetchLaunchComments(
      {
        productId: productIdOf(LISTED),
        launchId: launchIdOf(CURRENT_LAUNCH),
      },
      options,
    ),
    fetchLaunchCommentCounts(productIdOf(LISTED), options),
    fetchProductRating(productIdOf(LISTED), options),
  ]);
  const countRows = counts.data?.launchCommentCounts;
  return {
    errors: [
      ...(comments.errors ?? []),
      ...(counts.errors ?? []),
      ...(rating.errors ?? []),
    ],
    launchComments: comments.data?.launchComments,
    launchCommentCounts:
      countRows?.toSorted((left, right) =>
        left.launchId.localeCompare(right.launchId),
      ) ?? countRows,
    productRating: rating.data?.productRating,
  };
}

const HIDDEN_SECTIONS = {
  errors: [],
  launchComments: null,
  launchCommentCounts: null,
  productRating: null,
} as const;

async function readStoredRows() {
  return {
    comments: await countComments(),
    top: await readComment(TOP),
    reply: await readComment(OWNER_REPLY),
    ratings: await readRatingsOf(LISTED),
  };
}

describe('照会の前提', () => {
  test('どの状態にもしていなければ、3つの照会がスレッド・件数・評価欄の値を返す', async () => {
    const sections = await readSections(await optionsOf('評価済みの他者'));

    expect(sections.errors).toEqual([]);
    expect(
      sections.launchComments?.nodes.map(({ comment, replies }) => [
        comment.id,
        replies.map(({ id }) => id),
      ]),
    ).toEqual([[commentIdOf(TOP), [commentIdOf(OWNER_REPLY)]]]);
    expect(sections.launchCommentCounts).toEqual([
      { launchId: launchIdOf(WON_LAUNCH), count: 0 },
      { launchId: launchIdOf(CURRENT_LAUNCH), count: 2 },
    ]);
    expect(sections.productRating).toEqual({
      productId: productIdOf(LISTED),
      average: 3,
      count: 2,
      viewerScore: 2,
    });
  });
});

describe.each(LIFECYCLE_STATES)('$nameの間と戻した後', (state) => {
  test.each(VIEWER_KINDS)(
    `${state.name}の間は、%sにスレッド・件数・評価欄の照会をエラー無しのnullで返し、データを変えない`,
    async (kind) => {
      const options = await optionsOf(kind);
      const rowsBefore = await readStoredRows();
      await state.apply();

      const sections = await readSections(options);

      expect(sections).toEqual(HIDDEN_SECTIONS);
      expect(await readStoredRows()).toEqual(rowsBefore);
    },
  );

  test.each(VIEWER_KINDS)(
    `${state.name}を戻すと、%sに3つの照会が前と同じ値を返す`,
    async (kind) => {
      const options = await optionsOf(kind);
      const before = await readSections(options);
      await state.apply();
      const during = await readSections(options);

      await state.revert();
      const restored = await readSections(options);

      expect(before.errors).toEqual([]);
      expect(during).toEqual(HIDDEN_SECTIONS);
      expect(before.launchComments?.nodes).toHaveLength(1);
      expect(before.productRating?.count).toBe(2);
      expect(restored).toEqual(before);
    },
  );
});

describe('プロダクトの非公開化の間の投稿者本人', () => {
  test('投稿者本人にも3つの照会をnullで返し、復元すると返す', async () => {
    const options = {
      sessionToken: await issueEngagementUserSession(OWNER),
    };
    await setProductHidden(after(60_000));

    const hidden = await readSections(options);
    await setProductHidden(null);
    const restored = await readSections(options);

    expect(hidden).toEqual(HIDDEN_SECTIONS);
    expect(restored.errors).toEqual([]);
    expect(restored.launchComments?.nodes).toHaveLength(1);
    expect(restored.launchCommentCounts).toHaveLength(2);
    expect(restored.productRating).toEqual({
      productId: productIdOf(LISTED),
      average: 3,
      count: 2,
      viewerScore: null,
    });
  });
});

type WriteOperation =
  | 'postComment'
  | 'updateComment'
  | 'deleteComment'
  | 'rateProduct'
  | 'cancelProductRating';

const REJECTION_OF: Readonly<Record<WriteOperation, EngagementErrorCode>> = {
  postComment: 'comment_target_not_found',
  updateComment: 'comment_not_found',
  deleteComment: 'comment_not_found',
  rateProduct: 'rating_target_not_found',
  cancelProductRating: 'rating_target_not_found',
};

const WRITE_OPERATIONS = Object.keys(REJECTION_OF) as WriteOperation[];

// 評価済みの利用者2が、自分のトップレベルのコメントとプロダクトへ各操作を送る
function sendAsCommenter(operation: WriteOperation, sessionToken: string) {
  const commentId = commentIdOf(TOP);
  const productId = productIdOf(LISTED);
  switch (operation) {
    case 'postComment':
      return postComment(
        {
          productId,
          launchId: launchIdOf(CURRENT_LAUNCH),
          body: '新しいコメント',
          rating: 5,
        },
        { sessionToken, botToken: botTokenFor(COMMENT_BOT_ACTIONS.post) },
      );
    case 'updateComment':
      return updateComment(
        { commentId, body: '書き直しました', rating: 5 },
        { sessionToken, botToken: botTokenFor(COMMENT_BOT_ACTIONS.edit) },
      );
    case 'deleteComment':
      return deleteComment(commentId, {
        sessionToken,
        botToken: botTokenFor(COMMENT_BOT_ACTIONS.delete),
      });
    case 'rateProduct':
      return rateProduct({ productId, score: 5 }, { sessionToken });
    case 'cancelProductRating':
      return cancelProductRating(productId, { sessionToken });
  }
}

describe.each(LIFECYCLE_STATES)('$nameの間の書き込み', (state) => {
  test.each(WRITE_OPERATIONS)(
    `${state.name}の間は%sを見つからない旨で拒否し、コメントと評価を変えない`,
    async (operation) => {
      stubExternalServices();
      const sessionToken = await issueEngagementUserSession(COMMENTER);
      await state.apply();
      const rowsBefore = await readStoredRows();

      const response = await sendAsCommenter(operation, sessionToken);

      const code = REJECTION_OF[operation];
      expect(codesOf(response)).toEqual([code]);
      expect(response.errors?.[0]?.message).toBe(
        ENGAGEMENT_ERRORS[code].message,
      );
      expect(await readStoredRows()).toEqual(rowsBefore);
    },
  );
});
