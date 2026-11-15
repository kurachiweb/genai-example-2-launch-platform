import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  SAMPLE_COMMENT_ID,
  SAMPLE_LAUNCH_ID,
  SAMPLE_MEMBER_ID,
  SAMPLE_OWNER_ID,
  SAMPLE_PRODUCT_ID,
  SAMPLE_RATING_ID,
  SAMPLE_RATING_SCORE,
  seedEngagementPlatformSample,
} from '../../lib/workers/engagement/testing/engagement-platform-fixtures.ts';
import {
  type CommentReader,
  StoreCommentReader,
} from '../application/engagement/comment-reader.ts';
import {
  type CommentService,
  StoreCommentService,
} from '../application/engagement/comment-service.ts';
import { ENGAGEMENT_TYPES } from '../application/engagement/engagement-types.ts';
import {
  DirectoryEngagementTargetResolver,
  type EngagementTargetResolver,
} from '../application/engagement/engagement-target-resolver.ts';
import type {
  CommentWriter,
  RatingWriter,
} from '../application/engagement/ports.ts';
import {
  type RatingService,
  StoreRatingService,
} from '../application/engagement/rating-service.ts';
import { currentUserOf } from '../application/engagement/testing/comment-fakes.ts';
import { D1CommentWriter } from '../infrastructure/engagement/d1-comment-writer.ts';
import { D1RatingWriter } from '../infrastructure/engagement/d1-rating-writer.ts';
import {
  after,
  commentIdOf,
  countComments,
  insertComment,
  insertComments,
  insertLaunch,
  insertProduct,
  launchIdOf,
  readComment,
  readRating,
  readRatingsOf,
  T0,
} from '../../lib/workers/engagement/testing/engagement-fixtures.ts';
import {
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../lib/core/time/business-time.ts';
import { MODULES } from './modules.ts';

const NOW = new Date('2026-11-15T03:00:00.000Z');

const LAUNCH_DAY_NOON = fromBusinessDateTime(parseBusinessDate('2026-11-20'), {
  hour: 12,
  minute: 0,
});

function createContainer(): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    MODULES,
  );
}

beforeEach(seedEngagementPlatformSample);

describe('APIサーバーのモジュールの一覧へのエンゲージメントの登録', () => {
  test('エンゲージメントのapiの束縛を1つだけ持ち、共通の束縛とプロダクトの共通の束縛の後に置く', () => {
    const names = MODULES.map(({ name }) => name);

    expect(names.filter((name) => name === 'engagement')).toHaveLength(1);
    expect(names.indexOf('engagement')).toBeGreaterThan(
      names.indexOf('engagement-platform'),
    );
    expect(names.indexOf('engagement')).toBeGreaterThan(
      names.indexOf('product-platform'),
    );
  });
});

describe('APIサーバーのエンゲージメントの束縛', () => {
  test('投稿先の解決を処理単位のコンテナから解決する', () => {
    expect(
      createContainer().get<EngagementTargetResolver>(
        ENGAGEMENT_TYPES.EngagementTargetResolver,
      ),
    ).toBeInstanceOf(DirectoryEngagementTargetResolver);
  });

  test('解決した投稿先の解決は、D1のプロダクトとローンチを読み、未掲載のプロダクトを投稿者本人にだけ解決する', async () => {
    const resolver = createContainer().get<EngagementTargetResolver>(
      ENGAGEMENT_TYPES.EngagementTargetResolver,
    );
    const input = {
      productId: SAMPLE_PRODUCT_ID,
      launchId: SAMPLE_LAUNCH_ID,
      now: NOW,
    };

    const ownerTarget = await resolver.resolve({
      ...input,
      viewerUserId: SAMPLE_OWNER_ID,
    });
    const memberTarget = await resolver.resolve({
      ...input,
      viewerUserId: SAMPLE_MEMBER_ID,
    });

    expect(ownerTarget?.product).toMatchObject({
      productId: SAMPLE_PRODUCT_ID,
      ownerUserId: SAMPLE_OWNER_ID,
      listed: false,
    });
    expect(ownerTarget?.launch).toMatchObject({
      launchId: SAMPLE_LAUNCH_ID,
      productId: SAMPLE_PRODUCT_ID,
    });
    expect(ownerTarget?.viewerIsOwner).toBe(true);
    expect(memberTarget).toBeUndefined();
  });
});

describe('APIサーバーのコメントの投稿の束縛', () => {
  test('コメントのユースケースと書き込みの単位を処理単位のコンテナから解決する', () => {
    const container = createContainer();

    expect(
      container.get<CommentService>(ENGAGEMENT_TYPES.CommentService),
    ).toBeInstanceOf(StoreCommentService);
    expect(
      container.get<CommentWriter>(ENGAGEMENT_TYPES.CommentWriter),
    ).toBeInstanceOf(D1CommentWriter);
  });

  test('解決したユースケースは、掲載中のプロダクトのキックオフ当日のローンチへの評価を添えた投稿でD1にコメントと評価を保存する', async () => {
    await insertLaunch(2, 1, {
      launchDate: '2026-11-10',
      outcome: 'won',
      decidedAt: T0,
    });
    const service = createContainer().get<CommentService>(
      ENGAGEMENT_TYPES.CommentService,
    );
    const before = await countComments();

    const result = await service.post({
      user: currentUserOf(SAMPLE_MEMBER_ID),
      productId: SAMPLE_PRODUCT_ID,
      launchId: SAMPLE_LAUNCH_ID,
      parentId: undefined,
      body: '本文',
      rating: 2,
      now: LAUNCH_DAY_NOON,
    });

    expect(result.comment).toMatchObject({
      kind: 'shown',
      authorUserId: SAMPLE_MEMBER_ID,
      byProductOwner: false,
    });
    expect(await countComments()).toBe(before + 1);
    expect(await readRatingsOf(1)).toEqual([
      expect.objectContaining({ userId: SAMPLE_MEMBER_ID, score: 2 }),
    ]);
  });
});

describe('APIサーバーのコメントの編集と削除の束縛', () => {
  test('解決したユースケースは、掲載中のプロダクトの自分のコメントの本文と評価をD1で更新し、削除で置き換え表示にする', async () => {
    await insertLaunch(2, 1, {
      launchDate: '2026-11-10',
      outcome: 'won',
      decidedAt: T0,
    });
    const service = createContainer().get<CommentService>(
      ENGAGEMENT_TYPES.CommentService,
    );
    const user = currentUserOf(SAMPLE_MEMBER_ID);

    const updated = await service.update({
      user,
      commentId: SAMPLE_COMMENT_ID,
      body: '直した本文',
      rating: 5,
      now: LAUNCH_DAY_NOON,
    });
    const removed = await service.remove({
      user,
      commentId: SAMPLE_COMMENT_ID,
      now: LAUNCH_DAY_NOON,
    });

    expect(updated.comment).toMatchObject({
      kind: 'shown',
      bodyMarkdown: '直した本文',
      edited: true,
    });
    expect(await readRatingsOf(1)).toEqual([
      expect.objectContaining({ userId: SAMPLE_MEMBER_ID, score: 5 }),
    ]);
    expect(removed).toEqual({
      kind: 'removed',
      id: SAMPLE_COMMENT_ID,
      parentId: null,
      depth: 1,
    });
    expect(await readComment(1)).toMatchObject({
      body: '直した本文',
      editedAt: LAUNCH_DAY_NOON,
      deletedAt: LAUNCH_DAY_NOON,
    });
  });
});

describe('APIサーバーのスレッドの読み取りの束縛', () => {
  const PAGE_NOW = new Date('2026-11-15T03:00:00.000Z');

  // 第1回のローンチにトップレベル12件(番号が大きいほど新しく、3は削除、12はプロダクトの投稿者)と12への返信1件を作り、第2回の勝ちで掲載中にする
  async function seedThreads(): Promise<void> {
    await insertLaunch(2, 1, {
      launchDate: '2026-11-10',
      outcome: 'won',
      decidedAt: T0,
    });
    await insertLaunch(3, 1, { launchDate: '2026-11-12', cancelledAt: T0 });
    await insertProduct(2, 1);
    await insertLaunch(4, 2);
    await insertComments([
      ...Array.from({ length: 11 }, (_, offset) => {
        const index = offset + 2;
        return {
          index,
          product: 1,
          launch: 1,
          author: index === 12 ? 1 : 2,
          columns: {
            createdAt: after(index * 1000),
            ...(index === 3 ? { deletedAt: after(99_000) } : {}),
          },
        };
      }),
      {
        index: 13,
        product: 1,
        launch: 1,
        author: 2,
        parent: { index: 12, root: 12 },
        depth: 2,
        columns: { createdAt: after(13_000) },
      },
    ]);
  }

  const readerOf = (): CommentReader =>
    createContainer().get<CommentReader>(ENGAGEMENT_TYPES.CommentReader);

  test('スレッドの読み取りを処理単位のコンテナから解決する', () => {
    expect(readerOf()).toBeInstanceOf(StoreCommentReader);
  });

  test('解決した読み取りは、D1のトップレベルを新しい順に10件ずつ返し、置き換え表示で終わるページのカーソルで間の投稿を重複・欠落させずに続きを返す', async () => {
    await seedThreads();
    const reader = readerOf();
    const input = {
      productId: SAMPLE_PRODUCT_ID,
      launchId: SAMPLE_LAUNCH_ID,
      viewer: currentUserOf(SAMPLE_MEMBER_ID),
      now: PAGE_NOW,
    };

    const first = await reader.page({ ...input, after: undefined });
    await insertComment({
      index: 14,
      product: 1,
      launch: 1,
      author: 2,
      columns: { createdAt: after(14_000) },
    });
    const second = await reader.page({
      ...input,
      after: first?.endCursor ?? undefined,
    });

    expect(first?.threads.map(({ comment }) => comment.id)).toEqual(
      [12, 11, 10, 9, 8, 7, 6, 5, 4, 3].map(commentIdOf),
    );
    expect(first?.threads.at(-1)?.comment.kind).toBe('removed');
    expect(first?.hasNextPage).toBe(true);
    expect(first?.threads[0]).toMatchObject({
      comment: {
        kind: 'shown',
        authorUserId: SAMPLE_OWNER_ID,
        byProductOwner: true,
        viewerIsAuthor: false,
      },
      replies: [
        {
          id: commentIdOf(13),
          parentId: commentIdOf(12),
          byProductOwner: false,
          viewerIsAuthor: true,
        },
      ],
    });
    expect(first?.threads[0]?.replies).toHaveLength(1);
    expect(second?.threads.map(({ comment }) => comment.id)).toEqual(
      [2, 1].map(commentIdOf),
    );
    expect(second?.hasNextPage).toBe(false);
  });

  test('解決した読み取りは、不正なカーソルをinvalid_cursorで拒否する', async () => {
    await seedThreads();

    await expect(
      readerOf().page({
        productId: SAMPLE_PRODUCT_ID,
        launchId: SAMPLE_LAUNCH_ID,
        viewer: undefined,
        after: 'not-a-cursor',
        now: PAGE_NOW,
      }),
    ).rejects.toMatchObject({ code: 'invalid_cursor' });
  });

  test('解決した読み取りは、別のプロダクトのローンチと、未掲載のプロダクトの他者からの一覧と件数をnullにする', async () => {
    const reader = readerOf();
    const viewer = currentUserOf(SAMPLE_MEMBER_ID);

    const unlistedPage = await reader.page({
      productId: SAMPLE_PRODUCT_ID,
      launchId: SAMPLE_LAUNCH_ID,
      viewer,
      after: undefined,
      now: PAGE_NOW,
    });
    const unlistedCounts = await reader.counts({
      productId: SAMPLE_PRODUCT_ID,
      viewer,
      now: PAGE_NOW,
    });
    await seedThreads();
    const otherLaunch = await reader.page({
      productId: SAMPLE_PRODUCT_ID,
      launchId: launchIdOf(4),
      viewer,
      after: undefined,
      now: PAGE_NOW,
    });

    expect(unlistedPage).toBeNull();
    expect(unlistedCounts).toBeNull();
    expect(otherLaunch).toBeNull();
  });

  test('解決した読み取りは、取消を除くローンチごとの表示できるコメントの数を返し、コメントの無いローンチを0で補う', async () => {
    await seedThreads();

    const counts = await readerOf().counts({
      productId: SAMPLE_PRODUCT_ID,
      viewer: undefined,
      now: PAGE_NOW,
    });

    expect(counts).toEqual([
      { launchId: SAMPLE_LAUNCH_ID, count: 12 },
      { launchId: launchIdOf(2), count: 0 },
    ]);
  });
});

describe('APIサーバーの評価の束縛', () => {
  const RATING_NOW = new Date('2026-11-15T03:00:00.000Z');

  const serviceOf = (): RatingService =>
    createContainer().get<RatingService>(ENGAGEMENT_TYPES.RatingService);

  async function listSampleProduct(): Promise<void> {
    await insertLaunch(2, 1, {
      launchDate: '2026-11-10',
      outcome: 'won',
      decidedAt: T0,
    });
  }

  test('評価のユースケースと書き込みの単位を処理単位のコンテナから解決する', () => {
    const container = createContainer();

    expect(
      container.get<RatingService>(ENGAGEMENT_TYPES.RatingService),
    ).toBeInstanceOf(StoreRatingService);
    expect(
      container.get<RatingWriter>(ENGAGEMENT_TYPES.RatingWriter),
    ).toBeInstanceOf(D1RatingWriter);
  });

  test('解決したユースケースは、無効化された自分の評価を返し、上書きで無効化を保ち、取消で行ごと消し、評価し直すと平均値と件数に含める', async () => {
    await listSampleProduct();
    const service = serviceOf();
    const user = currentUserOf(SAMPLE_MEMBER_ID);
    const input = { productId: SAMPLE_PRODUCT_ID, now: RATING_NOW };

    const read = await service.read({ ...input, viewer: user });
    const overwritten = await service.rate({ ...input, user, score: 2 });
    const overwrittenRow = await readRating(1);
    const canceled = await service.cancel({ ...input, user });
    const canceledRow = await readRating(1);
    const rated = await service.rate({ ...input, user, score: 5 });

    expect(read).toEqual({
      productId: SAMPLE_PRODUCT_ID,
      average: null,
      count: 0,
      viewerScore: SAMPLE_RATING_SCORE,
    });
    expect(overwritten).toEqual({
      productId: SAMPLE_PRODUCT_ID,
      average: null,
      count: 0,
      viewerScore: 2,
    });
    expect(overwrittenRow).toMatchObject({
      id: SAMPLE_RATING_ID,
      score: 2,
      invalidatedAt: expect.any(Date) as Date,
    });
    expect(canceled).toEqual({
      productId: SAMPLE_PRODUCT_ID,
      average: null,
      count: 0,
      viewerScore: null,
    });
    expect(canceledRow).toBeUndefined();
    expect(rated).toEqual({
      productId: SAMPLE_PRODUCT_ID,
      average: 5,
      count: 1,
      viewerScore: 5,
    });
  });

  test('解決したユースケースは、投稿者本人の評価を拒否して自分の評価をnullにし、未掲載のプロダクトの他者からの評価と取消を拒否する', async () => {
    const service = serviceOf();
    const owner = currentUserOf(SAMPLE_OWNER_ID);
    const member = currentUserOf(SAMPLE_MEMBER_ID);
    const input = { productId: SAMPLE_PRODUCT_ID, now: RATING_NOW };

    const ownerView = await service.read({ ...input, viewer: owner });

    await expect(
      service.rate({ ...input, user: owner, score: 5 }),
    ).rejects.toMatchObject({ code: 'rating_own_product' });
    await expect(
      service.rate({ ...input, user: member, score: 5 }),
    ).rejects.toMatchObject({ code: 'rating_target_not_found' });
    await expect(
      service.cancel({ ...input, user: member }),
    ).rejects.toMatchObject({ code: 'rating_target_not_found' });
    expect(ownerView).toMatchObject({ viewerScore: null });
    expect(await readRatingsOf(1)).toEqual([
      expect.objectContaining({
        id: SAMPLE_RATING_ID,
        score: SAMPLE_RATING_SCORE,
      }),
    ]);
  });
});
