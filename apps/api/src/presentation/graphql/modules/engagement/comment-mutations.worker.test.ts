import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { launchComments } from '../../../../../db/schema/engagement/launch-comments.ts';

import {
  COMMENT_BOT_ACTIONS,
  COMMENT_MAX_GRAPHEMES,
  OWN_PRODUCT_RATING_MESSAGE,
} from '../../../../../common-lib/engagement/engagement-rules.ts';
import {
  commentIdOf,
  countComments,
  countRatings,
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
import { ENGAGEMENT_ERRORS } from '../../../../application/engagement/engagement-errors.ts';
import {
  deleteComment,
  ENGAGEMENT_TEST_NOW,
  installEngagementGraphQLTest,
  issueEngagementUserSession,
  type LaunchCommentFields,
  postComment,
  type PostCommentVariables,
  updateComment,
} from '../../../../../test/support/engagement-graphql-operations.ts';
import {
  BOT_REJECTED_TOKEN,
  BOT_UNREACHABLE_TOKEN,
  botTokenFor,
  type GatewayCallOptions,
  stubExternalServices,
} from '../../../../../test/support/graphql-gateway.ts';
import {
  codesOf,
  detailsOf,
} from '../../../../../test/support/product-graphql-operations.ts';

installEngagementGraphQLTest();

const OWNER = 1;
const COMMENTER = 2;
const RATER = 3;
const UNVERIFIED = 4;
const SUSPENDED = 5;

const LISTED = 1;
const SCHEDULED_PRODUCT = 2;

const WON_LAUNCH = 1;
const CURRENT_LAUNCH = 2;
const SCHEDULED_LAUNCH = 3;

const COMMENTER_TOP = 1;
const COMMENTER_REPLY = 2;
const UNVERIFIED_TOP = 3;
const SUSPENDED_TOP = 4;
const OWNER_TOP = 5;

const RATER_RATING = 1;

const POST_TOKEN = botTokenFor(COMMENT_BOT_ACTIONS.post);
const EDIT_TOKEN = botTokenFor(COMMENT_BOT_ACTIONS.edit);
const DELETE_TOKEN = botTokenFor(COMMENT_BOT_ACTIONS.delete);

const VALIDATION_MESSAGE = '入力内容を確認してください。';
const RATING_MESSAGE = '評価は1〜5で選んでください。';
const RATING_ON_REPLY_MESSAGE = '返信には評価を付けられません。';

// プロダクト1は利用者1の掲載中(勝利したローンチ1を持つ)のプロダクトで、当日のローンチ2にコメントできる。利用者3はプロダクト1を4と評価済み
async function seedProduct(): Promise<void> {
  await insertUser(OWNER, { emailVerifiedAt: T0 });
  await insertUser(COMMENTER, { emailVerifiedAt: T0 });
  await insertUser(RATER, { emailVerifiedAt: T0 });
  await insertUser(UNVERIFIED);
  await insertUser(SUSPENDED, { status: 'suspended', suspendedAt: T0 });
  await insertProduct(LISTED, OWNER);
  await insertLaunch(WON_LAUNCH, LISTED, {
    launchDate: '2026-11-05',
    outcome: 'won',
    decidedAt: T0,
  });
  await insertLaunch(CURRENT_LAUNCH, LISTED, { launchDate: '2026-11-10' });
  await insertRating({
    index: RATER_RATING,
    product: LISTED,
    user: RATER,
    score: 4,
  });
}

// 当日のローンチ2に、利用者2のトップレベル1とその返信2、未確認の利用者4のトップレベル3、停止中の利用者5のトップレベル4、投稿者本人のトップレベル5を置く
async function seedComments(): Promise<void> {
  await insertComments([
    {
      index: COMMENTER_TOP,
      product: LISTED,
      launch: CURRENT_LAUNCH,
      author: COMMENTER,
    },
    {
      index: COMMENTER_REPLY,
      product: LISTED,
      launch: CURRENT_LAUNCH,
      author: COMMENTER,
      parent: { index: COMMENTER_TOP, root: COMMENTER_TOP },
      depth: 2,
    },
    {
      index: UNVERIFIED_TOP,
      product: LISTED,
      launch: CURRENT_LAUNCH,
      author: UNVERIFIED,
    },
    {
      index: SUSPENDED_TOP,
      product: LISTED,
      launch: CURRENT_LAUNCH,
      author: SUSPENDED,
    },
    {
      index: OWNER_TOP,
      product: LISTED,
      launch: CURRENT_LAUNCH,
      author: OWNER,
    },
  ]);
}

beforeEach(async () => {
  await seedProduct();
  await seedComments();
});

const topLevelPost = (
  fields: Partial<PostCommentVariables> = {},
): PostCommentVariables => ({
  productId: productIdOf(LISTED),
  launchId: launchIdOf(CURRENT_LAUNCH),
  body: '**良い**プロダクトです',
  ...fields,
});

type Operation = 'postComment' | 'updateComment' | 'deleteComment';

const OPERATIONS: readonly Operation[] = [
  'postComment',
  'updateComment',
  'deleteComment',
];

const TOKEN_OF: Readonly<Record<Operation, string>> = {
  postComment: POST_TOKEN,
  updateComment: EDIT_TOKEN,
  deleteComment: DELETE_TOKEN,
};

const OWN_COMMENT_OF: Readonly<Record<number, number>> = {
  [COMMENTER]: COMMENTER_TOP,
  [UNVERIFIED]: UNVERIFIED_TOP,
  [SUSPENDED]: SUSPENDED_TOP,
};

// 各操作を利用者の自分のトップレベルのコメントへ送る
async function send(
  operation: Operation,
  user: number,
  options: GatewayCallOptions,
) {
  const commentId = commentIdOf(OWN_COMMENT_OF[user] ?? COMMENTER_TOP);
  if (operation === 'postComment') {
    return postComment(topLevelPost(), options);
  }
  if (operation === 'updateComment') {
    return updateComment({ commentId, body: '書き直しました' }, options);
  }
  return deleteComment(commentId, options);
}

async function readCommentTables() {
  return {
    comments: await countComments(),
    ratings: await readRatingsOf(LISTED),
    top: await readComment(COMMENTER_TOP),
    reply: await readComment(COMMENTER_REPLY),
    ownerTop: await readComment(OWNER_TOP),
    unverifiedTop: await readComment(UNVERIFIED_TOP),
    suspendedTop: await readComment(SUSPENDED_TOP),
  };
}

async function readCommentById(commentId: string | undefined) {
  if (commentId === undefined) {
    return undefined;
  }
  const [row] = await db
    .select()
    .from(launchComments)
    .where(eq(launchComments.id, commentId));
  return row;
}

const shownByViewer = (
  fields: Pick<LaunchCommentFields, 'id' | 'parentId' | 'depth' | 'body'> &
    Partial<LaunchCommentFields>,
): LaunchCommentFields => ({
  state: 'SHOWN',
  author: {
    handle: `user${String(COMMENTER)}`,
    nickname: `利用者${String(COMMENTER)}`,
    avatar: null,
  },
  createdAt: ENGAGEMENT_TEST_NOW.toISOString(),
  edited: false,
  byProductOwner: false,
  viewerIsAuthor: true,
  ...fields,
});

describe('postComment・updateComment・deleteComment: 拒否の順', () => {
  test.each(OPERATIONS)(
    '管理者側の呼び出し元からの%sは、bot判定の前にforbiddenで拒否する',
    async (operation) => {
      const calls = stubExternalServices();
      const token = await issueEngagementUserSession(COMMENTER);

      const response = await send(operation, COMMENTER, {
        caller: 'admin',
        sessionToken: token,
        botToken: TOKEN_OF[operation],
      });

      expect(codesOf(response)).toEqual(['forbidden']);
      expect(calls.siteverifyTokens).toEqual([]);
    },
  );

  test.each(OPERATIONS)(
    'ログインしていなければ、%sをbot判定を使わずunauthenticatedで拒否する',
    async (operation) => {
      const calls = stubExternalServices();
      const before = await readCommentTables();

      const response = await send(operation, COMMENTER, {
        botToken: TOKEN_OF[operation],
      });

      expect(codesOf(response)).toEqual(['unauthenticated']);
      expect(calls.siteverifyTokens).toEqual([]);
      expect(await readCommentTables()).toEqual(before);
    },
  );

  test.each(OPERATIONS)(
    '停止中の利用者の%sは、メールアドレスが確認済みでなくてもbot判定を使わずaccount_unavailableで拒否する',
    async (operation) => {
      const calls = stubExternalServices();
      const token = await issueEngagementUserSession(SUSPENDED);
      const before = await readCommentTables();

      const response = await send(operation, SUSPENDED, {
        sessionToken: token,
        botToken: TOKEN_OF[operation],
      });

      expect(codesOf(response)).toEqual(['account_unavailable']);
      expect(calls.siteverifyTokens).toEqual([]);
      expect(await readCommentTables()).toEqual(before);
    },
  );

  test.each(['postComment', 'updateComment'] as const)(
    'メールアドレスが未確認の利用者の%sは、bot判定を使わずemail_not_verifiedで拒否する',
    async (operation) => {
      const calls = stubExternalServices();
      const token = await issueEngagementUserSession(UNVERIFIED);
      const before = await readCommentTables();

      const response = await send(operation, UNVERIFIED, {
        sessionToken: token,
        botToken: TOKEN_OF[operation],
      });

      expect(codesOf(response)).toEqual(['email_not_verified']);
      expect(calls.siteverifyTokens).toEqual([]);
      expect(await readCommentTables()).toEqual(before);
    },
  );

  test('メールアドレスが未確認の利用者でも、bot判定を通れば自分のコメントを削除できる', async () => {
    const calls = stubExternalServices();
    const token = await issueEngagementUserSession(UNVERIFIED);

    const response = await deleteComment(commentIdOf(UNVERIFIED_TOP), {
      sessionToken: token,
      botToken: DELETE_TOKEN,
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.deleteComment?.state).toBe('REMOVED');
    expect(calls.siteverifyTokens).toEqual([DELETE_TOKEN]);
    expect((await readComment(UNVERIFIED_TOP))?.deletedAt).toEqual(
      ENGAGEMENT_TEST_NOW,
    );
  });

  test.each(
    OPERATIONS.flatMap((operation) => [
      [operation, 'トークンが無い', undefined, 'bot_verification_failed'],
      [
        operation,
        '判定に失敗する',
        BOT_REJECTED_TOKEN,
        'bot_verification_failed',
      ],
      [
        operation,
        '別の操作名の判定の結果である',
        botTokenFor(
          operation === 'postComment'
            ? COMMENT_BOT_ACTIONS.edit
            : COMMENT_BOT_ACTIONS.post,
        ),
        'bot_verification_failed',
      ],
      [
        operation,
        '判定サービスに到達できない',
        BOT_UNREACHABLE_TOKEN,
        'bot_verification_unavailable',
      ],
    ]),
  )(
    '%sでbot判定の%s場合は記録を変えずに拒否する',
    async (operation, _name, botToken, code) => {
      stubExternalServices();
      const token = await issueEngagementUserSession(COMMENTER);
      const before = await readCommentTables();

      const response = await send(
        operation,
        COMMENTER,
        botToken === undefined
          ? { sessionToken: token }
          : { sessionToken: token, botToken },
      );

      expect(codesOf(response)).toEqual([code]);
      expect(await readCommentTables()).toEqual(before);
    },
  );

  test.each(OPERATIONS)(
    '%sは操作ごとの操作名のbot判定を1回だけ使う',
    async (operation) => {
      const calls = stubExternalServices();
      const token = await issueEngagementUserSession(COMMENTER);

      const response = await send(operation, COMMENTER, {
        sessionToken: token,
        botToken: TOKEN_OF[operation],
      });

      expect(response.errors).toBeUndefined();
      expect(calls.siteverifyTokens).toEqual([TOKEN_OF[operation]]);
    },
  );
});

describe('postComment・updateComment・deleteComment: 入力の検証', () => {
  const overLimit = 'あ'.repeat(COMMENT_MAX_GRAPHEMES + 1);

  test.each([
    [
      '2,000文字を超える',
      overLimit,
      'コメントは2,000文字以内で入力してください。',
    ],
    ['空白だけの', ' \n　', 'コメントを入力してください。'],
    [
      '使用できない文字を含む',
      '制御\u0007文字',
      'コメントに使用できない文字が含まれています。',
    ],
  ])(
    '%s本文の投稿と編集を、bot判定を使わず文言規則の文言のvalidation_errorにする',
    async (_name, body, message) => {
      const calls = stubExternalServices();
      const token = await issueEngagementUserSession(COMMENTER);
      const before = await readCommentTables();

      const posted = await postComment(topLevelPost({ body }), {
        sessionToken: token,
        botToken: POST_TOKEN,
      });
      const updated = await updateComment(
        { commentId: commentIdOf(COMMENTER_TOP), body },
        { sessionToken: token, botToken: EDIT_TOKEN },
      );

      for (const response of [posted, updated]) {
        expect(codesOf(response)).toEqual(['validation_error']);
        expect(response.errors?.[0]?.message).toBe(VALIDATION_MESSAGE);
        expect(detailsOf(response)).toEqual([
          { field: 'input.body', code: 'custom', message },
        ]);
      }
      expect(calls.siteverifyTokens).toEqual([]);
      expect(await readCommentTables()).toEqual(before);
    },
  );

  test('本文の文字数を書記素で数え、結合文字を含む絵文字の2,000文字を受け付ける', async () => {
    stubExternalServices();
    const token = await issueEngagementUserSession(COMMENTER);
    const body = '👍🏽'.repeat(COMMENT_MAX_GRAPHEMES);

    const response = await postComment(topLevelPost({ body }), {
      sessionToken: token,
      botToken: POST_TOKEN,
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.postComment?.comment.body).toBe(body);
  });

  test.each([0, 6])(
    '評価の%iを、bot判定を使わずvalidation_errorにしてコメントも評価も保存しない',
    async (rating) => {
      const calls = stubExternalServices();
      const token = await issueEngagementUserSession(COMMENTER);
      const before = await readCommentTables();

      const posted = await postComment(topLevelPost({ rating }), {
        sessionToken: token,
        botToken: POST_TOKEN,
      });
      const updated = await updateComment(
        { commentId: commentIdOf(COMMENTER_TOP), body: '書き直し', rating },
        { sessionToken: token, botToken: EDIT_TOKEN },
      );

      for (const response of [posted, updated]) {
        expect(codesOf(response)).toEqual(['validation_error']);
        expect(detailsOf(response)).toEqual([
          {
            field: 'input.rating',
            code: 'invalid_value',
            message: RATING_MESSAGE,
          },
        ]);
      }
      expect(calls.siteverifyTokens).toEqual([]);
      expect(await readCommentTables()).toEqual(before);
    },
  );

  test('形式の違うIDを、それぞれの対象が見つからない文言のvalidation_errorにする', async () => {
    const calls = stubExternalServices();
    const token = await issueEngagementUserSession(COMMENTER);

    const posted = await postComment(
      topLevelPost({ productId: 'product-1', parentId: 'parent-1' }),
      { sessionToken: token, botToken: POST_TOKEN },
    );
    const updated = await updateComment(
      { commentId: commentIdOf(COMMENTER_TOP).toLowerCase(), body: '書き直し' },
      { sessionToken: token, botToken: EDIT_TOKEN },
    );
    const deleted = await deleteComment('comment-1', {
      sessionToken: token,
      botToken: DELETE_TOKEN,
    });

    expect(detailsOf(posted)).toEqual([
      {
        field: 'input.productId',
        code: 'invalid_format',
        message: ENGAGEMENT_ERRORS.comment_target_not_found.message,
      },
      {
        field: 'input.parentId',
        code: 'invalid_format',
        message: ENGAGEMENT_ERRORS.comment_parent_unavailable.message,
      },
    ]);
    expect(detailsOf(updated)).toEqual([
      {
        field: 'input.commentId',
        code: 'invalid_format',
        message: ENGAGEMENT_ERRORS.comment_not_found.message,
      },
    ]);
    expect(detailsOf(deleted)).toEqual([
      {
        field: 'commentId',
        code: 'invalid_format',
        message: ENGAGEMENT_ERRORS.comment_not_found.message,
      },
    ]);
    expect(calls.siteverifyTokens).toEqual([]);
  });
});

describe('postComment: 投稿と評価', () => {
  test('評価を添えないトップレベルの投稿は、コメントを返して評価をnullにし、既存の評価を変えない', async () => {
    stubExternalServices();
    const token = await issueEngagementUserSession(RATER);
    const ratingsBefore = await readRatingsOf(LISTED);

    const response = await postComment(topLevelPost({ rating: null }), {
      sessionToken: token,
      botToken: POST_TOKEN,
    });

    const result = response.data?.postComment;
    expect(response.errors).toBeUndefined();
    expect(result?.rating).toBeNull();
    expect(result?.comment).toEqual(
      shownByViewer({
        id: expect.any(String) as string,
        parentId: null,
        depth: 1,
        body: '**良い**プロダクトです',
        author: {
          handle: `user${String(RATER)}`,
          nickname: `利用者${String(RATER)}`,
          avatar: null,
        },
      }),
    );
    const saved = await readCommentById(result?.comment.id);
    expect(saved?.authorUserId).toBe(userIdOf(RATER));
    expect(saved?.body).toBe('**良い**プロダクトです');
    expect(await readRatingsOf(LISTED)).toEqual(ratingsBefore);
  });

  test('評価を添えたトップレベルの投稿は、コメントと評価を保存し、評価欄の値を返す', async () => {
    stubExternalServices();
    const token = await issueEngagementUserSession(COMMENTER);

    const response = await postComment(topLevelPost({ rating: 2 }), {
      sessionToken: token,
      botToken: POST_TOKEN,
    });

    const result = response.data?.postComment;
    expect(response.errors).toBeUndefined();
    expect(result?.rating).toEqual({
      productId: productIdOf(LISTED),
      average: 3,
      count: 2,
      viewerScore: 2,
    });
    expect(result?.comment.state).toBe('SHOWN');
    expect(await readCommentById(result?.comment.id)).toBeDefined();
    const scores = (await readRatingsOf(LISTED)).map(({ userId, score }) => [
      userId,
      score,
    ]);
    expect(scores).toEqual(
      expect.arrayContaining([
        [userIdOf(RATER), 4],
        [userIdOf(COMMENTER), 2],
      ]),
    );
  });

  test('返信は親と階層を返し、評価を添えると返信の詳細のvalidation_errorにしてコメントも評価も保存しない', async () => {
    stubExternalServices();
    const token = await issueEngagementUserSession(RATER);
    const reply = topLevelPost({
      parentId: commentIdOf(COMMENTER_REPLY),
      body: '返信です',
    });

    const rejected = await postComment(
      { ...reply, rating: 5 },
      { sessionToken: token, botToken: POST_TOKEN },
    );
    const before = await readCommentTables();
    const accepted = await postComment(reply, {
      sessionToken: token,
      botToken: POST_TOKEN,
    });

    expect(codesOf(rejected)).toEqual(['validation_error']);
    expect(rejected.errors?.[0]?.message).toBe(VALIDATION_MESSAGE);
    expect(detailsOf(rejected)).toEqual([
      {
        field: 'input.rating',
        code: 'custom',
        message: RATING_ON_REPLY_MESSAGE,
      },
    ]);
    expect(before.comments).toBe(5);
    expect(before.ratings).toHaveLength(1);
    expect(accepted.errors).toBeUndefined();
    expect(accepted.data?.postComment?.comment).toMatchObject({
      parentId: commentIdOf(COMMENTER_REPLY),
      depth: 3,
      body: '返信です',
    });
    expect(accepted.data?.postComment?.rating).toBeNull();
  });

  test('投稿者本人は評価を添えずに投稿でき、評価を添えるとrating_own_productにしてコメントも評価も保存しない', async () => {
    stubExternalServices();
    const token = await issueEngagementUserSession(OWNER);
    const options = { sessionToken: token, botToken: POST_TOKEN };

    const rejected = await postComment(topLevelPost({ rating: 5 }), options);
    const counts = {
      comments: await countComments(),
      ratings: await countRatings(),
    };
    const accepted = await postComment(topLevelPost(), options);

    expect(codesOf(rejected)).toEqual(['rating_own_product']);
    expect(rejected.errors?.[0]?.message).toBe(OWN_PRODUCT_RATING_MESSAGE);
    expect(counts).toEqual({ comments: 5, ratings: 1 });
    expect(accepted.errors).toBeUndefined();
    expect(accepted.data?.postComment?.comment.byProductOwner).toBe(true);
  });

  test('投稿先の判定の拒否の理由をユースケースのとおりに返す', async () => {
    stubExternalServices();
    await insertProduct(SCHEDULED_PRODUCT, OWNER);
    await insertLaunch(SCHEDULED_LAUNCH, SCHEDULED_PRODUCT, {
      launchDate: '2026-11-12',
    });
    const token = await issueEngagementUserSession(COMMENTER);
    const owner = await issueEngagementUserSession(OWNER);
    const options = { sessionToken: token, botToken: POST_TOKEN };

    const missingProduct = await postComment(
      topLevelPost({ productId: productIdOf(99) }),
      options,
    );
    const otherLaunch = await postComment(
      topLevelPost({ launchId: launchIdOf(99) }),
      options,
    );

    const scheduled = await postComment(
      {
        productId: productIdOf(SCHEDULED_PRODUCT),
        launchId: launchIdOf(SCHEDULED_LAUNCH),
        body: 'キックオフ前',
      },
      { sessionToken: owner, botToken: POST_TOKEN },
    );

    expect(codesOf(missingProduct)).toEqual(['comment_target_not_found']);
    expect(codesOf(otherLaunch)).toEqual(['comment_target_not_found']);
    expect(codesOf(scheduled)).toEqual(['launch_not_commentable']);
    expect(await countComments()).toBe(5);
  });
});

describe('updateComment: 編集と評価', () => {
  test('評価を添えたトップレベルの編集は、本文と評価を更新して編集済みのコメントと評価欄の値を返す', async () => {
    stubExternalServices();
    const token = await issueEngagementUserSession(COMMENTER);

    const response = await updateComment(
      {
        commentId: commentIdOf(COMMENTER_TOP),
        body: '書き直しました',
        rating: 5,
      },
      { sessionToken: token, botToken: EDIT_TOKEN },
    );

    const result = response.data?.updateComment;
    expect(response.errors).toBeUndefined();
    expect(result?.comment).toEqual(
      shownByViewer({
        id: commentIdOf(COMMENTER_TOP),
        parentId: null,
        depth: 1,
        body: '書き直しました',
        createdAt: T0.toISOString(),
        edited: true,
      }),
    );
    expect(result?.rating).toEqual({
      productId: productIdOf(LISTED),
      average: 4.5,
      count: 2,
      viewerScore: 5,
    });
    const saved = await readComment(COMMENTER_TOP);
    expect(saved?.body).toBe('書き直しました');
    expect(saved?.editedAt).toEqual(ENGAGEMENT_TEST_NOW);
  });

  test('評価を添えない編集は評価をnullで返し、既存の評価を変えない', async () => {
    stubExternalServices();
    const token = await issueEngagementUserSession(RATER);
    await insertComments([
      { index: 9, product: LISTED, launch: CURRENT_LAUNCH, author: RATER },
    ]);
    const ratingsBefore = await readRatingsOf(LISTED);

    const response = await updateComment(
      { commentId: commentIdOf(9), body: '書き直しました' },
      { sessionToken: token, botToken: EDIT_TOKEN },
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.updateComment?.rating).toBeNull();
    expect(await readRatingsOf(LISTED)).toEqual(ratingsBefore);
  });

  test('返信と投稿者本人の編集に評価を添えると、本文も評価も更新せずに拒否する', async () => {
    stubExternalServices();
    const commenter = await issueEngagementUserSession(COMMENTER);
    const owner = await issueEngagementUserSession(OWNER);
    const before = await readCommentTables();

    const reply = await updateComment(
      { commentId: commentIdOf(COMMENTER_REPLY), body: '書き直し', rating: 3 },
      { sessionToken: commenter, botToken: EDIT_TOKEN },
    );
    const own = await updateComment(
      { commentId: commentIdOf(OWNER_TOP), body: '書き直し', rating: 3 },
      { sessionToken: owner, botToken: EDIT_TOKEN },
    );

    expect(codesOf(reply)).toEqual(['validation_error']);
    expect(detailsOf(reply)).toEqual([
      {
        field: 'input.rating',
        code: 'custom',
        message: RATING_ON_REPLY_MESSAGE,
      },
    ]);
    expect(codesOf(own)).toEqual(['rating_own_product']);
    expect(await readCommentTables()).toEqual(before);
  });

  test('他者のコメントの編集と削除をcomment_not_foundにする', async () => {
    stubExternalServices();
    const token = await issueEngagementUserSession(RATER);
    const before = await readCommentTables();

    const updated = await updateComment(
      { commentId: commentIdOf(COMMENTER_TOP), body: '書き換え' },
      { sessionToken: token, botToken: EDIT_TOKEN },
    );
    const deleted = await deleteComment(commentIdOf(COMMENTER_TOP), {
      sessionToken: token,
      botToken: DELETE_TOKEN,
    });

    expect(codesOf(updated)).toEqual(['comment_not_found']);
    expect(codesOf(deleted)).toEqual(['comment_not_found']);
    expect(await readCommentTables()).toEqual(before);
  });
});

describe('deleteComment: 削除', () => {
  test('自分の返信のあるコメントを削除すると、置き換え表示のコメントを返し、返信を残す', async () => {
    stubExternalServices();
    const token = await issueEngagementUserSession(COMMENTER);

    const response = await deleteComment(commentIdOf(COMMENTER_TOP), {
      sessionToken: token,
      botToken: DELETE_TOKEN,
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.deleteComment).toEqual({
      id: commentIdOf(COMMENTER_TOP),
      parentId: null,
      depth: 1,
      state: 'REMOVED',
      author: null,
      body: null,
      createdAt: null,
      edited: false,
      byProductOwner: false,
      viewerIsAuthor: false,
    });
    expect((await readComment(COMMENTER_TOP))?.deletedAt).toEqual(
      ENGAGEMENT_TEST_NOW,
    );
    expect((await readComment(COMMENTER_REPLY))?.deletedAt).toBeNull();
  });
});
