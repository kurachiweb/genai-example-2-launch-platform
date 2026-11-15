import { describe, expect, test } from 'bun:test';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import type { RatingScore } from '../../../common-lib/engagement/engagement-rules.ts';
import {
  LAUNCH_NOT_COMMENTABLE_MESSAGE,
  OWN_PRODUCT_RATING_MESSAGE,
} from '../../../common-lib/engagement/engagement-rules.ts';
import type {
  CommentRecord,
  RatingSummary,
} from '../../../lib/core/engagement/ports.ts';
import type { LaunchRecord } from '../../../lib/core/product/ports.ts';
import { StoreCommentService } from './comment-service.ts';
import { DirectoryEngagementTargetResolver } from './engagement-target-resolver.ts';
import type { CommentPostWrite, WriteOutcome } from './ports.ts';
import {
  commentRecordOf,
  createFakeCommentStore,
  createFakeCommentWriter,
  createFakeRatingStore,
  createSequentialIds,
  currentUserOf,
  NEW_COMMENT_ID,
  NEW_RATING_ID,
  PARENT_ID,
  ROOT_ID,
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

interface SetupOptions {
  readonly listed?: boolean;
  readonly launches?: readonly LaunchRecord[];
  readonly comments?: readonly CommentRecord[];
  readonly summaries?: ReadonlyMap<string, RatingSummary>;
  readonly scores?: ReadonlyMap<string, RatingScore>;
  readonly onPost?: (
    input: CommentPostWrite,
    world: {
      readonly state: FakeProductState;
      readonly comments: Map<string, CommentRecord>;
    },
  ) => WriteOutcome;
}

function setup(options: SetupOptions = {}) {
  const state = activeState();
  const targets = createFakeTargetDirectory({
    products: [
      { summary: summaryOf({ listed: options.listed ?? true }), state },
      {
        summary: summaryOf({
          productId: OTHER_PRODUCT_ID,
          ownerUserId: MEMBER_ID,
        }),
        state: activeState(),
      },
    ],
    launches: options.launches ?? [
      launchOf(),
      launchOf({ launchId: OTHER_LAUNCH_ID, productId: OTHER_PRODUCT_ID }),
    ],
  });
  const comments = createFakeCommentStore(options.comments);
  const ratings = createFakeRatingStore({
    summaries: options.summaries,
    scores: options.scores,
  });
  const onPost = options.onPost;
  const writer = createFakeCommentWriter({
    onPost:
      onPost === undefined
        ? undefined
        : (input) => onPost(input, { state, comments: comments.records }),
  });
  const service = new StoreCommentService(
    new DirectoryEngagementTargetResolver(targets.directory),
    comments.store,
    ratings.store,
    writer.writer,
    createSequentialIds([NEW_COMMENT_ID, NEW_RATING_ID]),
  );
  return { service, state, targets, comments, ratings, writer };
}

interface PostOverrides {
  readonly userId?: string;
  readonly launchId?: string;
  readonly parentId?: string;
  readonly body?: string;
  readonly rating?: RatingScore;
}

function postInput(overrides: PostOverrides = {}) {
  return {
    user: currentUserOf(overrides.userId ?? MEMBER_ID),
    productId: PRODUCT_ID,
    launchId: overrides.launchId ?? LAUNCH_ID,
    parentId: overrides.parentId,
    body: overrides.body ?? '本文',
    rating: overrides.rating,
    now: NOW,
  };
}

async function rejectionOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof AppError) {
      return error;
    }
    throw error;
  }
  throw new Error('拒否されなかった');
}

function hidden(): FakeProductState {
  return { ...activeState(), hidden: true };
}

describe('CommentService.post: トップレベルの投稿', () => {
  test('本文をマークダウンの原文のまま、トップレベルのコメントとして評価を添えずに書き込みの単位へ渡す', async () => {
    const { service, writer, ratings } = setup();
    const body = '**太字**と<script>alert(1)</script>';

    const result = await service.post(postInput({ body }));

    expect(writer.posts).toEqual([
      {
        comment: {
          commentId: NEW_COMMENT_ID,
          productId: PRODUCT_ID,
          launchId: LAUNCH_ID,
          parent: null,
          authorUserId: MEMBER_ID,
          bodyMarkdown: body,
          requireListed: true,
          at: NOW,
        },
        rating: undefined,
      },
    ]);
    expect(result).toEqual({
      comment: {
        kind: 'shown',
        id: NEW_COMMENT_ID,
        parentId: null,
        depth: 1,
        authorUserId: MEMBER_ID,
        bodyMarkdown: body,
        createdAt: NOW,
        edited: false,
        byProductOwner: false,
        viewerIsAuthor: true,
      },
      rating: undefined,
    });
    expect(ratings.summaryReads).toHaveLength(0);
    expect(ratings.scoreReads).toHaveLength(0);
  });

  test('投稿者本人のコメントを未掲載の自身のプロダクトでも受け付け、掲載を条件にせず投稿者のバッジを付ける', async () => {
    const { service, writer } = setup({ listed: false });

    const result = await service.post(postInput({ userId: OWNER_ID }));

    expect(writer.posts[0]?.comment).toMatchObject({
      authorUserId: OWNER_ID,
      requireListed: false,
    });
    expect(result.comment).toMatchObject({
      kind: 'shown',
      byProductOwner: true,
      viewerIsAuthor: true,
    });
  });

  test('結果の確定したローンチへのコメントを受け付ける', async () => {
    const { service, writer } = setup({
      launches: [launchOf({ status: 'finished', outcome: 'won' })],
    });

    await service.post(postInput());

    expect(writer.posts).toHaveLength(1);
  });
});

describe('CommentService.post: 投稿先とローンチの判定', () => {
  test.each([
    ['非公開化', { ...activeState(), hidden: true }],
    ['論理削除', { ...activeState(), deleted: true }],
    ['投稿者の停止', { ...activeState(), ownerSuspended: true }],
    ['投稿者の退会', { ...activeState(), ownerWithdrawn: true }],
  ])(
    '%sのプロダクトへの投稿はcomment_target_not_foundで拒否し、書き込まない',
    async (_, productState) => {
      const { service, state, writer } = setup();
      Object.assign(state, productState);

      const pending = service.post(postInput());

      expect(await rejectionOf(pending)).toMatchObject({
        kind: 'not_found',
        code: 'comment_target_not_found',
        message:
          'コメント先のプロダクトが見つかりません。ページを再読み込みしてください。',
      });
      expect(writer.posts).toHaveLength(0);
    },
  );

  test('他者の未掲載のプロダクトへの投稿は、同じcomment_target_not_foundで拒否する', async () => {
    const { service, writer } = setup({ listed: false });

    expect(await rejectionOf(service.post(postInput()))).toMatchObject({
      code: 'comment_target_not_found',
    });
    expect(writer.posts).toHaveLength(0);
  });

  test('別のプロダクトのローンチ・存在しないローンチ・取消のローンチはcomment_target_not_foundで拒否する', async () => {
    const canceledId = '01JD0LNCH00000000000000003';
    const { service, writer } = setup({
      launches: [
        launchOf(),
        launchOf({ launchId: OTHER_LAUNCH_ID, productId: OTHER_PRODUCT_ID }),
        launchOf({ launchId: canceledId, status: 'canceled' }),
      ],
    });

    for (const launchId of [
      OTHER_LAUNCH_ID,
      '01JD0LNCH00000000000000009',
      canceledId,
    ]) {
      expect(
        await rejectionOf(service.post(postInput({ launchId }))),
      ).toMatchObject({ code: 'comment_target_not_found' });
    }
    expect(writer.posts).toHaveLength(0);
  });

  test.each(['scheduled', 'paired'] as const)(
    'キックオフ前(%s)のローンチへの投稿はlaunch_not_commentableで拒否する',
    async (status) => {
      const { service, writer } = setup({ launches: [launchOf({ status })] });

      expect(await rejectionOf(service.post(postInput()))).toMatchObject({
        kind: 'unprocessable',
        code: 'launch_not_commentable',
        message: LAUNCH_NOT_COMMENTABLE_MESSAGE,
      });
      expect(writer.posts).toHaveLength(0);
    },
  );

  test('投稿先を閲覧できなければ、ローンチの状態より先にcomment_target_not_foundを返す', async () => {
    const { service, state } = setup({
      launches: [launchOf({ status: 'scheduled' })],
    });
    Object.assign(state, hidden());

    expect(await rejectionOf(service.post(postInput()))).toMatchObject({
      code: 'comment_target_not_found',
    });
  });

  test('キックオフ前のローンチへの返信は、親の判定より先にlaunch_not_commentableを返す', async () => {
    const { service } = setup({
      launches: [launchOf({ status: 'scheduled' })],
    });

    expect(
      await rejectionOf(service.post(postInput({ parentId: PARENT_ID }))),
    ).toMatchObject({ code: 'launch_not_commentable' });
  });
});

describe('CommentService.post: 返信', () => {
  test('トップレベルへの返信は、親のIDとルートと階層を書き込みの単位へ渡し、第2階層のコメントを返す', async () => {
    const { service, writer, comments } = setup({
      comments: [commentRecordOf()],
    });

    const result = await service.post(postInput({ parentId: PARENT_ID }));

    expect(comments.reads).toEqual([[PARENT_ID]]);
    expect(writer.posts[0]?.comment.parent).toEqual({
      commentId: PARENT_ID,
      rootId: PARENT_ID,
      depth: 1,
    });
    expect(result.comment).toMatchObject({
      kind: 'shown',
      id: NEW_COMMENT_ID,
      parentId: PARENT_ID,
      depth: 2,
    });
  });

  test('第2階層への返信は親のルートを引き継ぎ、第3階層のコメントを返す', async () => {
    const { service, writer } = setup({
      comments: [
        commentRecordOf({ parentId: ROOT_ID, rootId: ROOT_ID, depth: 2 }),
      ],
    });

    const result = await service.post(postInput({ parentId: PARENT_ID }));

    expect(writer.posts[0]?.comment.parent).toEqual({
      commentId: PARENT_ID,
      rootId: ROOT_ID,
      depth: 2,
    });
    expect(result.comment.depth).toBe(3);
  });

  test.each([
    ['第3階層', { parentId: ROOT_ID, rootId: ROOT_ID, depth: 3 as const }],
    ['削除', { deletedAt: NOW }],
    ['非公開化', { hiddenAt: NOW }],
    ['匿名化', { anonymizedAt: NOW, authorUserId: null, bodyMarkdown: '' }],
    ['投稿者の紐付けの解除', { authorUserId: null }],
    ['別のローンチ', { launchId: OTHER_LAUNCH_ID }],
  ])(
    '%sの親への返信はcomment_parent_unavailableで拒否し、書き込まない',
    async (_, overrides) => {
      const { service, writer } = setup({
        comments: [commentRecordOf(overrides)],
      });

      expect(
        await rejectionOf(service.post(postInput({ parentId: PARENT_ID }))),
      ).toMatchObject({
        kind: 'unprocessable',
        code: 'comment_parent_unavailable',
        message:
          '返信先のコメントには返信できません。ページを再読み込みしてください。',
      });
      expect(writer.posts).toHaveLength(0);
    },
  );

  test('存在しない親への返信はcomment_parent_unavailableで拒否する', async () => {
    const { service, writer } = setup();

    expect(
      await rejectionOf(service.post(postInput({ parentId: PARENT_ID }))),
    ).toMatchObject({ code: 'comment_parent_unavailable' });
    expect(writer.posts).toHaveLength(0);
  });

  test('投稿者本人の返信も受け付け、投稿者のバッジを付ける', async () => {
    const { service } = setup({ comments: [commentRecordOf()] });

    const result = await service.post(
      postInput({ userId: OWNER_ID, parentId: PARENT_ID }),
    );

    expect(result.comment).toMatchObject({ byProductOwner: true });
  });
});

describe('CommentService.post: 評価を添えた投稿', () => {
  test('トップレベルの投稿に添えた評価を、コメントと同じ1回の書き込みの単位に渡し、更新後の評価欄の値を返す', async () => {
    const { service, writer, ratings } = setup({
      summaries: new Map([[PRODUCT_ID, { average: 4.5, count: 2 }]]),
      scores: new Map([[MEMBER_ID, 5]]),
    });

    const result = await service.post(postInput({ rating: 5 }));

    expect(writer.posts).toHaveLength(1);
    expect(writer.posts[0]).toMatchObject({
      comment: { commentId: NEW_COMMENT_ID, parent: null },
      rating: {
        ratingId: NEW_RATING_ID,
        productId: PRODUCT_ID,
        userId: MEMBER_ID,
        score: 5,
        at: NOW,
      },
    });
    expect(result.rating).toEqual({
      productId: PRODUCT_ID,
      average: 4.5,
      count: 2,
      viewerScore: 5,
    });
    expect(ratings.summaryReads).toEqual([[PRODUCT_ID]]);
    expect(ratings.scoreReads).toEqual([
      { productId: PRODUCT_ID, userId: MEMBER_ID },
    ]);
  });

  test('評価の集計が無ければ平均をnull・件数を0として返す', async () => {
    const { service } = setup();

    const result = await service.post(postInput({ rating: 3 }));

    expect(result.rating).toEqual({
      productId: PRODUCT_ID,
      average: null,
      count: 0,
      viewerScore: null,
    });
  });

  test('返信に添えた評価はvalidation_errorの評価の項目で拒否し、書き込まない', async () => {
    const { service, writer } = setup({ comments: [commentRecordOf()] });

    const pending = service.post(postInput({ parentId: PARENT_ID, rating: 4 }));

    expect(await rejectionOf(pending)).toMatchObject({
      kind: 'bad_request',
      code: 'validation_error',
      details: [
        {
          field: 'rating',
          code: 'custom',
          message: '返信には評価を付けられません。',
        },
      ],
    });
    expect(writer.posts).toHaveLength(0);
  });

  test('投稿者本人が添えた評価はrating_own_productで拒否し、コメントも書き込まない', async () => {
    const { service, writer } = setup();

    expect(
      await rejectionOf(
        service.post(postInput({ userId: OWNER_ID, rating: 5 })),
      ),
    ).toMatchObject({
      kind: 'unprocessable',
      code: 'rating_own_product',
      message: OWN_PRODUCT_RATING_MESSAGE,
    });
    expect(writer.posts).toHaveLength(0);
  });

  test('返信が表示できない親へのものなら、評価の判定より先にcomment_parent_unavailableを返す', async () => {
    const { service } = setup({
      comments: [commentRecordOf({ deletedAt: NOW })],
    });

    expect(
      await rejectionOf(
        service.post(postInput({ parentId: PARENT_ID, rating: 4 })),
      ),
    ).toMatchObject({ code: 'comment_parent_unavailable' });
  });
});

describe('CommentService.post: 書き込みの単位の拒否の分類', () => {
  test('判定の後にプロダクトが非公開化されて拒否されたら、読み直してcomment_target_not_foundを返す', async () => {
    const { service, targets } = setup({
      onPost: (_, { state }) => {
        Object.assign(state, hidden());
        return 'rejected';
      },
    });

    expect(
      await rejectionOf(service.post(postInput({ rating: 4 }))),
    ).toMatchObject({
      code: 'comment_target_not_found',
    });
    expect(targets.summaryReads).toHaveLength(2);
  });

  test('判定の後に投稿者が停止されて投稿先が閲覧できなくなれば、同じくcomment_target_not_foundを返す', async () => {
    const { service } = setup({
      onPost: (_, { state }) => {
        Object.assign(state, { ownerSuspended: true });
        return 'rejected';
      },
    });

    expect(await rejectionOf(service.post(postInput()))).toMatchObject({
      code: 'comment_target_not_found',
    });
  });

  test('判定の後に親が削除されて拒否されたら、読み直してcomment_parent_unavailableを返す', async () => {
    const parent = commentRecordOf();
    const { service, comments } = setup({
      comments: [parent],
      onPost: (_, world) => {
        world.comments.set(PARENT_ID, { ...parent, deletedAt: NOW });
        return 'rejected';
      },
    });

    expect(
      await rejectionOf(service.post(postInput({ parentId: PARENT_ID }))),
    ).toMatchObject({ code: 'comment_parent_unavailable' });
    expect(comments.reads).toEqual([[PARENT_ID], [PARENT_ID]]);
  });

  test('読み直した投稿先とローンチに変化が無いトップレベルの投稿の拒否は、利用者の状態の変化としてaccount_unavailableを返す', async () => {
    const { service, ratings } = setup({ onPost: () => 'rejected' });

    expect(
      await rejectionOf(service.post(postInput({ rating: 4 }))),
    ).toMatchObject({
      kind: 'forbidden',
      code: 'account_unavailable',
    });
    expect(ratings.summaryReads).toHaveLength(0);
  });

  test('読み直した投稿先・ローンチ・親の行に変化が無い返信の拒否は、親の投稿者が表示できないものとしてcomment_parent_unavailableを返す', async () => {
    const { service } = setup({
      comments: [commentRecordOf()],
      onPost: () => 'rejected',
    });

    expect(
      await rejectionOf(service.post(postInput({ parentId: PARENT_ID }))),
    ).toMatchObject({ code: 'comment_parent_unavailable' });
  });
});
