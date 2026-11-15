import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import { ENGAGEMENT_PLATFORM_TYPES } from '../../lib/core/engagement/identifiers.ts';
import type {
  CommentStore,
  RatingExport,
} from '../../lib/core/engagement/ports.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { D1CommentStatements } from '../../lib/workers/engagement/comment-statements.ts';
import { D1AdminCommentDirectory } from '../../lib/workers/engagement/d1-admin-comment-directory.ts';
import { D1AdminRatingDirectory } from '../../lib/workers/engagement/d1-admin-rating-directory.ts';
import { D1CommentStore } from '../../lib/workers/engagement/d1-comment-store.ts';
import { D1CommentThreadQuery } from '../../lib/workers/engagement/d1-comment-thread-query.ts';
import { D1EngagementErasureStore } from '../../lib/workers/engagement/d1-engagement-erasure-store.ts';
import {
  D1CommentExport,
  D1RatingExport,
} from '../../lib/workers/engagement/d1-engagement-export.ts';
import { D1RatingStore } from '../../lib/workers/engagement/d1-rating-store.ts';
import { D1RatingStatements } from '../../lib/workers/engagement/rating-statements.ts';
import {
  SAMPLE_COMMENT_ID,
  SAMPLE_MEMBER_ID,
  SAMPLE_PRODUCT_ID,
  seedEngagementPlatformSample,
} from '../../lib/workers/engagement/testing/engagement-platform-fixtures.ts';
import { MODULES } from './modules.ts';

const IMPLEMENTATIONS: readonly (readonly [
  symbol,
  abstract new (...args: never[]) => unknown,
])[] = [
  [ENGAGEMENT_PLATFORM_TYPES.CommentStore, D1CommentStore],
  [ENGAGEMENT_PLATFORM_TYPES.CommentStatements, D1CommentStatements],
  [ENGAGEMENT_PLATFORM_TYPES.CommentThreadQuery, D1CommentThreadQuery],
  [ENGAGEMENT_PLATFORM_TYPES.RatingStore, D1RatingStore],
  [ENGAGEMENT_PLATFORM_TYPES.RatingStatements, D1RatingStatements],
  [ENGAGEMENT_PLATFORM_TYPES.EngagementErasureStore, D1EngagementErasureStore],
  [ENGAGEMENT_PLATFORM_TYPES.CommentExport, D1CommentExport],
  [ENGAGEMENT_PLATFORM_TYPES.RatingExport, D1RatingExport],
  [ENGAGEMENT_PLATFORM_TYPES.AdminCommentDirectory, D1AdminCommentDirectory],
  [ENGAGEMENT_PLATFORM_TYPES.AdminRatingDirectory, D1AdminRatingDirectory],
];

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
  test('エンゲージメントの共通の束縛を1つだけ持つ', () => {
    expect(
      MODULES.filter(({ name }) => name === 'engagement-platform'),
    ).toHaveLength(1);
  });
});

describe('APIサーバーのエンゲージメントの共通の束縛', () => {
  test('処理単位のコンテナから束縛した10個の識別子をD1の実装に解決する', () => {
    const container = createContainer();

    expect(IMPLEMENTATIONS).toHaveLength(10);
    for (const [identifier, implementation] of IMPLEMENTATIONS) {
      expect(container.get(identifier)).toBeInstanceOf(implementation);
    }
  });

  test('処理単位のコンテナから解決したコメントのストアと評価の出力で、コメントと無効化の印付きの評価を引ける', async () => {
    const container = createContainer();

    await expect(
      container
        .get<CommentStore>(ENGAGEMENT_PLATFORM_TYPES.CommentStore)
        .findByIds([SAMPLE_COMMENT_ID]),
    ).resolves.toEqual(
      new Map([
        [
          SAMPLE_COMMENT_ID,
          expect.objectContaining({ authorUserId: SAMPLE_MEMBER_ID }),
        ],
      ]),
    );
    await expect(
      container
        .get<RatingExport>(ENGAGEMENT_PLATFORM_TYPES.RatingExport)
        .listByUser(SAMPLE_MEMBER_ID),
    ).resolves.toEqual([
      expect.objectContaining({
        productId: SAMPLE_PRODUCT_ID,
        invalidatedByAdmin: true,
      }),
    ]);
  });
});
