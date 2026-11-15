import { describe, expect, test } from 'bun:test';

import type { RatingScore } from '../../../common-lib/engagement/engagement-rules.ts';
import { OWN_PRODUCT_RATING_MESSAGE } from '../../../common-lib/engagement/engagement-rules.ts';
import type {
  CommentRecord,
  CommentSoftDelete,
  RatingSummary,
} from '../../../lib/core/engagement/ports.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type { UserAccountView } from '../../../lib/core/identity/account-guard.ts';
import type { LaunchRecord } from '../../../lib/core/product/ports.ts';
import { StoreCommentService } from './comment-service.ts';
import { DirectoryEngagementTargetResolver } from './engagement-target-resolver.ts';
import type { CommentUpdateOutcome, CommentUpdateWrite } from './ports.ts';
import {
  commentRecordOf,
  createFakeCommentStore,
  createFakeCommentWriter,
  createFakeRatingStore,
  createSequentialIds,
  currentUserOf,
  NEW_RATING_ID,
  PARENT_ID,
} from './testing/comment-fakes.ts';
import {
  activeState,
  createFakeTargetDirectory,
  type FakeProductState,
  LAUNCH_ID,
  launchOf,
  MEMBER_ID,
  NOW,
  OWNER_ID,
  PRODUCT_ID,
  summaryOf,
} from './testing/target-fakes.ts';

const COMMENT_ID = '01JD0CMNT00000000000000010';
const REPLY_ID = '01JD0CMNT00000000000000011';
const OTHER_MEMBER_ID = '01JD0USER00000000000000003';

const CREATED_AT = new Date(NOW.getTime() - 400 * 24 * 60 * 60 * 1000);

const COMMENT_NOT_FOUND_MESSAGE =
  'コメントが見つかりません。削除された可能性があります。';

const ownComment = (overrides: Partial<CommentRecord> = {}): CommentRecord =>
  commentRecordOf({
    commentId: COMMENT_ID,
    rootId: COMMENT_ID,
    authorUserId: MEMBER_ID,
    bodyMarkdown: '元の本文',
    createdAt: CREATED_AT,
    ...overrides,
  });

const ownReply = (overrides: Partial<CommentRecord> = {}): CommentRecord =>
  ownComment({
    commentId: REPLY_ID,
    parentId: PARENT_ID,
    rootId: PARENT_ID,
    depth: 2,
    ...overrides,
  });

interface SetupOptions {
  readonly listed?: boolean;
  readonly launches?: readonly LaunchRecord[];
  readonly comments?: readonly CommentRecord[];
  readonly summaries?: ReadonlyMap<string, RatingSummary>;
  readonly scores?: ReadonlyMap<string, RatingScore>;
  readonly onUpdate?: (
    input: CommentUpdateWrite,
    world: {
      readonly state: FakeProductState;
      readonly comments: Map<string, CommentRecord>;
    },
  ) => CommentUpdateOutcome;
  readonly onRemove?: (input: CommentSoftDelete) => 'deleted' | 'not-found';
}

function setup(options: SetupOptions = {}) {
  const state = activeState();
  const targets = createFakeTargetDirectory({
    products: [
      { summary: summaryOf({ listed: options.listed ?? true }), state },
    ],
    launches: options.launches ?? [launchOf()],
  });
  const comments = createFakeCommentStore(
    options.comments ?? [ownComment(), ownReply()],
  );
  const ratings = createFakeRatingStore({
    summaries: options.summaries,
    scores: options.scores,
  });
  const onUpdate = options.onUpdate;
  const writer = createFakeCommentWriter({
    onUpdate:
      onUpdate === undefined
        ? undefined
        : (input) => onUpdate(input, { state, comments: comments.records }),
    onRemove: options.onRemove,
  });
  const service = new StoreCommentService(
    new DirectoryEngagementTargetResolver(targets.directory),
    comments.store,
    ratings.store,
    writer.writer,
    createSequentialIds([NEW_RATING_ID]),
  );
  return { service, state, targets, comments, ratings, writer };
}

interface InputOverrides {
  readonly userId?: string;
  readonly user?: Partial<UserAccountView>;
  readonly commentId?: string;
  readonly body?: string;
  readonly rating?: RatingScore;
}

function updateInput(overrides: InputOverrides = {}) {
  return {
    user: currentUserOf(overrides.userId ?? MEMBER_ID, overrides.user),
    commentId: overrides.commentId ?? COMMENT_ID,
    body: overrides.body ?? '直した本文',
    rating: overrides.rating,
    now: NOW,
  };
}

function removeInput(overrides: InputOverrides = {}) {
  return {
    user: currentUserOf(overrides.userId ?? MEMBER_ID, overrides.user),
    commentId: overrides.commentId ?? COMMENT_ID,
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

function expectCommentNotFound(error: AppError): void {
  expect(error).toMatchObject({
    kind: 'not_found',
    code: 'comment_not_found',
    message: COMMENT_NOT_FOUND_MESSAGE,
  });
}

// 他者・置き換え表示・閲覧できないプロダクトのコメントの組み立て。どれも理由を区別せずに見つからないとする
const UNREACHABLE_CASES: readonly {
  readonly name: string;
  readonly options: SetupOptions;
  readonly product?: Partial<FakeProductState>;
}[] = [
  { name: '存在しないコメント', options: { comments: [] } },
  {
    name: '他者のコメント',
    options: { comments: [ownComment({ authorUserId: OTHER_MEMBER_ID })] },
  },
  {
    name: '削除済みのコメント',
    options: { comments: [ownComment({ deletedAt: CREATED_AT })] },
  },
  {
    name: '非公開化されたコメント',
    options: { comments: [ownComment({ hiddenAt: CREATED_AT })] },
  },
  {
    name: '匿名化されたコメント',
    options: {
      comments: [
        ownComment({
          authorUserId: null,
          bodyMarkdown: '',
          deletedAt: CREATED_AT,
          anonymizedAt: CREATED_AT,
        }),
      ],
    },
  },
  {
    name: '非公開化されたプロダクトのコメント',
    options: {},
    product: { hidden: true },
  },
  {
    name: '投稿者が停止中のプロダクトのコメント',
    options: {},
    product: { ownerSuspended: true },
  },
  {
    name: '他者の未掲載のプロダクトのコメント',
    options: { listed: false },
  },
];

describe('CommentService.update: 自分の表示できるコメントの編集', () => {
  test('本文をマークダウンの原文のまま、評価を添えずに書き込みの単位へ渡し、編集済みのコメントを返す', async () => {
    const { service, writer, targets, ratings } = setup();
    const body = '**直した**と<script>alert(1)</script>';

    const result = await service.update(updateInput({ body }));

    expect(writer.updates).toEqual([
      {
        body: {
          commentId: COMMENT_ID,
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
        id: COMMENT_ID,
        parentId: null,
        depth: 1,
        authorUserId: MEMBER_ID,
        bodyMarkdown: body,
        createdAt: CREATED_AT,
        edited: true,
        byProductOwner: false,
        viewerIsAuthor: true,
      },
      rating: undefined,
    });
    expect(targets.summaryReads).toEqual([
      { productIds: [PRODUCT_ID], scope: 'visible' },
    ]);
    expect(ratings.summaryReads).toEqual([]);
  });

  test('返信の編集は親とルートを保ったまま第2階層の編集済みのコメントを返す', async () => {
    const { service } = setup();

    const result = await service.update(updateInput({ commentId: REPLY_ID }));

    expect(result.comment).toMatchObject({
      kind: 'shown',
      id: REPLY_ID,
      parentId: PARENT_ID,
      depth: 2,
      edited: true,
    });
  });

  test('投稿者本人のコメントは未掲載の自身のプロダクトでも、掲載を条件にせず編集を受け付け、投稿者のバッジを付ける', async () => {
    const { service, writer } = setup({
      listed: false,
      comments: [ownComment({ authorUserId: OWNER_ID })],
    });

    const result = await service.update(updateInput({ userId: OWNER_ID }));

    expect(writer.updates[0]?.body.requireListed).toBe(false);
    expect(result.comment).toMatchObject({ byProductOwner: true });
  });

  test('投稿から1年以上経ったコメントでも、取消のローンチのコメントでも、ローンチを読まずに編集を受け付ける', async () => {
    const { service, writer, targets } = setup({
      launches: [launchOf({ status: 'canceled' })],
    });

    await service.update(updateInput());

    expect(writer.updates).toHaveLength(1);
    expect(targets.launchReads).toEqual([]);
  });

  test('キックオフ前のローンチのコメントでも編集を受け付ける', async () => {
    const { service, writer } = setup({
      launches: [launchOf({ status: 'scheduled' })],
    });

    await service.update(updateInput());

    expect(writer.updates).toHaveLength(1);
  });
});

describe('CommentService.update: 評価を添えた編集', () => {
  test('トップレベルの編集に添えた評価を、本文と同じ1回の書き込みの単位に渡し、更新後の評価欄の値を返す', async () => {
    const { service, writer, ratings } = setup({
      summaries: new Map([[PRODUCT_ID, { average: 3.5, count: 2 }]]),
      scores: new Map([[MEMBER_ID, 4]]),
    });

    const result = await service.update(updateInput({ rating: 4 }));

    expect(writer.updates).toHaveLength(1);
    expect(writer.updates[0]?.rating).toEqual({
      ratingId: NEW_RATING_ID,
      productId: PRODUCT_ID,
      userId: MEMBER_ID,
      score: 4,
      at: NOW,
    });
    expect(result.rating).toEqual({
      productId: PRODUCT_ID,
      average: 3.5,
      count: 2,
      viewerScore: 4,
    });
    expect(ratings.scoreReads).toEqual([
      { productId: PRODUCT_ID, userId: MEMBER_ID },
    ]);
  });

  test('返信の編集に添えた評価はvalidation_errorの評価の項目で拒否し、本文も書き込まない', async () => {
    const { service, writer } = setup();

    const error = await rejectionOf(
      service.update(updateInput({ commentId: REPLY_ID, rating: 3 })),
    );

    expect(error).toMatchObject({
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
    expect(writer.updates).toEqual([]);
  });

  test('投稿者本人が添えた評価はrating_own_productで拒否し、本文も書き込まない', async () => {
    const { service, writer } = setup({
      comments: [ownComment({ authorUserId: OWNER_ID })],
    });

    const error = await rejectionOf(
      service.update(updateInput({ userId: OWNER_ID, rating: 5 })),
    );

    expect(error).toMatchObject({
      kind: 'unprocessable',
      code: 'rating_own_product',
      message: OWN_PRODUCT_RATING_MESSAGE,
    });
    expect(writer.updates).toEqual([]);
  });

  test('対象が見つからなければ、評価の判定より先にcomment_not_foundを返す', async () => {
    const { service } = setup({
      comments: [ownReply({ authorUserId: OTHER_MEMBER_ID })],
    });

    const error = await rejectionOf(
      service.update(updateInput({ commentId: REPLY_ID, rating: 3 })),
    );

    expectCommentNotFound(error);
  });
});

describe('CommentService.update: 見つからないコメント', () => {
  for (const { name, options, product } of UNREACHABLE_CASES) {
    test(`${name}の編集は同じcomment_not_foundで拒否し、書き込まない`, async () => {
      const { service, state, writer } = setup(options);
      Object.assign(state, product);

      const error = await rejectionOf(service.update(updateInput()));

      expectCommentNotFound(error);
      expect(writer.updates).toEqual([]);
    });
  }

  test('書き込みの時点で対象の行が無ければcomment_not_foundを返す', async () => {
    const { service } = setup({ onUpdate: () => 'not-found' });

    const error = await rejectionOf(service.update(updateInput()));

    expectCommentNotFound(error);
  });
});

describe('CommentService.update: 書き込みの単位の拒否の分類', () => {
  test('判定の後にコメントが削除されて拒否されたら、読み直してcomment_not_foundを返す', async () => {
    const { service, comments } = setup({
      onUpdate: (_input, world) => {
        world.comments.set(COMMENT_ID, ownComment({ deletedAt: NOW }));
        return 'rejected';
      },
    });

    const error = await rejectionOf(service.update(updateInput()));

    expectCommentNotFound(error);
    expect(comments.reads).toEqual([[COMMENT_ID], [COMMENT_ID]]);
  });

  test('判定の後にプロダクトが非公開化されて拒否されたら、読み直してcomment_not_foundを返す', async () => {
    const { service } = setup({
      onUpdate: (_input, world) => {
        world.state.hidden = true;
        return 'rejected';
      },
    });

    const error = await rejectionOf(service.update(updateInput()));

    expectCommentNotFound(error);
  });

  test('読み直したコメントと投稿先に変化が無い拒否は、利用者の状態の変化としてaccount_unavailableを返す', async () => {
    const { service } = setup({ onUpdate: () => 'rejected' });

    const error = await rejectionOf(service.update(updateInput({ rating: 2 })));

    expect(error).toMatchObject({ code: 'account_unavailable' });
  });
});

describe('CommentService.remove: 自分の表示できるコメントの削除', () => {
  test('自分のコメントを書き込みの単位で削除し、置き換え表示の形で返す', async () => {
    const { service, writer, targets } = setup();

    const result = await service.remove(removeInput());

    expect(writer.removes).toEqual([
      { commentId: COMMENT_ID, authorUserId: MEMBER_ID, at: NOW },
    ]);
    expect(result).toEqual({
      kind: 'removed',
      id: COMMENT_ID,
      parentId: null,
      depth: 1,
    });
    expect(targets.summaryReads).toEqual([
      { productIds: [PRODUCT_ID], scope: 'visible' },
    ]);
  });

  test('返信の削除は親と階層を持つ置き換え表示を返す', async () => {
    const { service } = setup();

    const result = await service.remove(removeInput({ commentId: REPLY_ID }));

    expect(result).toEqual({
      kind: 'removed',
      id: REPLY_ID,
      parentId: PARENT_ID,
      depth: 2,
    });
  });

  test('メールアドレスを確認していない利用者の削除も受け付ける', async () => {
    const { service, writer } = setup();

    await service.remove(removeInput({ user: { emailVerifiedAt: null } }));

    expect(writer.removes).toHaveLength(1);
  });

  test('投稿から1年以上経ったコメントでも、取消のローンチのコメントでも、ローンチを読まずに削除を受け付ける', async () => {
    const { service, writer, targets } = setup({
      launches: [launchOf({ launchId: LAUNCH_ID, status: 'canceled' })],
    });

    await service.remove(removeInput());

    expect(writer.removes).toHaveLength(1);
    expect(targets.launchReads).toEqual([]);
  });
});

describe('CommentService.remove: 見つからないコメント', () => {
  for (const { name, options, product } of UNREACHABLE_CASES) {
    test(`${name}の削除は同じcomment_not_foundで拒否し、書き込まない`, async () => {
      const { service, state, writer } = setup(options);
      Object.assign(state, product);

      const error = await rejectionOf(service.remove(removeInput()));

      expectCommentNotFound(error);
      expect(writer.removes).toEqual([]);
    });
  }

  test('書き込みの単位の変更が0行ならcomment_not_foundを返す', async () => {
    const { service } = setup({ onRemove: () => 'not-found' });

    const error = await rejectionOf(service.remove(removeInput()));

    expectCommentNotFound(error);
  });
});
