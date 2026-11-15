import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Hono } from 'hono';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, expectTypeOf, test } from 'vitest';

import type { AppModule } from '../../core/di/app-module.ts';
import type { InvocationScopeInfo } from '../../core/di/identifiers.ts';
import { ENGAGEMENT_PLATFORM_TYPES } from '../../core/engagement/identifiers.ts';
import type {
  CommentExport,
  CommentStore,
  CommentThreadQuery,
  RatingExport,
  RatingStore,
} from '../../core/engagement/ports.ts';
import { createInvocationContainer } from '../di/invocation-container.ts';
import type { PlatformHonoEnv } from '../http/hono-env.ts';
import { D1CommentStatements } from './comment-statements.ts';
import { D1CommentStore } from './d1-comment-store.ts';
import { D1CommentThreadQuery } from './d1-comment-thread-query.ts';
import { D1EngagementErasureStore } from './d1-engagement-erasure-store.ts';
import { D1CommentExport, D1RatingExport } from './d1-engagement-export.ts';
import { D1RatingStore } from './d1-rating-store.ts';
import { ENGAGEMENT_PLATFORM_MODULE } from './engagement-platform-module.ts';
import { D1RatingStatements } from './rating-statements.ts';
import {
  SAMPLE_COMMENT_ID,
  SAMPLE_LAUNCH_ID,
  SAMPLE_MEMBER_ID,
  SAMPLE_PRODUCT_ID,
  SAMPLE_RATING_SCORE,
  seedEngagementPlatformSample,
} from './testing/engagement-platform-fixtures.ts';

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
];

function createContainer(
  kind: InvocationScopeInfo['kind'] = 'fetch',
): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind,
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    [ENGAGEMENT_PLATFORM_MODULE],
  );
}

beforeEach(seedEngagementPlatformSample);

describe('ENGAGEMENT_PLATFORM_MODULE', () => {
  test('両アプリのモジュールの一覧へ環境を指定した型のまま加えられる', () => {
    const modules: readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[] = [
      ENGAGEMENT_PLATFORM_MODULE,
    ];

    expectTypeOf(modules).toEqualTypeOf<
      readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[]
    >();
    expect(ENGAGEMENT_PLATFORM_MODULE.name).toBe('engagement-platform');
    expect('routes' in ENGAGEMENT_PLATFORM_MODULE).toBe(false);
  });

  test.each(['fetch', 'queue', 'scheduled'] as const)(
    '%sの処理単位でも束縛した8つの識別子をD1の実装に解決する',
    (kind) => {
      const container = createContainer(kind);

      expect(IMPLEMENTATIONS).toHaveLength(8);
      for (const [identifier, implementation] of IMPLEMENTATIONS) {
        expect(container.get(identifier)).toBeInstanceOf(implementation);
      }
    },
  );

  test('処理単位の中では同じインスタンスを返し、別の処理単位では別のインスタンスを返す', () => {
    const first = createContainer();
    const second = createContainer();

    for (const [identifier] of IMPLEMENTATIONS) {
      expect(first.get(identifier)).toBe(first.get(identifier));
      expect(second.get(identifier)).not.toBe(first.get(identifier));
    }
  });

  test('解決したコメントのストアとスレッドの照会と評価のストアで、コメントと評価の集計を引ける', async () => {
    const container = createContainer();
    const comments = container.get<CommentStore>(
      ENGAGEMENT_PLATFORM_TYPES.CommentStore,
    );
    const threads = container.get<CommentThreadQuery>(
      ENGAGEMENT_PLATFORM_TYPES.CommentThreadQuery,
    );
    const ratings = container.get<RatingStore>(
      ENGAGEMENT_PLATFORM_TYPES.RatingStore,
    );

    await expect(comments.findByIds([SAMPLE_COMMENT_ID])).resolves.toEqual(
      new Map([
        [
          SAMPLE_COMMENT_ID,
          expect.objectContaining({ authorUserId: SAMPLE_MEMBER_ID }),
        ],
      ]),
    );
    await expect(threads.countsByLaunch(SAMPLE_PRODUCT_ID)).resolves.toEqual(
      new Map([[SAMPLE_LAUNCH_ID, 1]]),
    );
    await expect(
      ratings.findScore({
        productId: SAMPLE_PRODUCT_ID,
        userId: SAMPLE_MEMBER_ID,
      }),
    ).resolves.toMatchObject({ score: SAMPLE_RATING_SCORE });
  });

  test('解決した出力の部品で、本人のコメントと無効化の印付きの評価を引ける', async () => {
    const container = createContainer('queue');

    await expect(
      container
        .get<CommentExport>(ENGAGEMENT_PLATFORM_TYPES.CommentExport)
        .listByUser(SAMPLE_MEMBER_ID),
    ).resolves.toEqual([expect.objectContaining({ id: SAMPLE_COMMENT_ID })]);
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
