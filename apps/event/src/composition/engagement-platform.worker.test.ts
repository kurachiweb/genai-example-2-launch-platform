import {
  applyD1Migrations,
  createExecutionContext,
  type D1Migration,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { ENGAGEMENT_PLATFORM_TYPES } from '../../lib/core/engagement/identifiers.ts';
import type {
  CommentExport,
  RatingExport,
} from '../../lib/core/engagement/ports.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { D1CommentStatements } from '../../lib/workers/engagement/comment-statements.ts';
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

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const INVOCATION_KINDS = ['fetch', 'queue'] as const;

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

function createContainer(kind: (typeof INVOCATION_KINDS)[number]): Container {
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
    MODULES,
  );
}

// setupFilesでcloudflare:testを読み込むと、他のテストファイルのvi.mockより先にエントリが読み込まれて差し替えが効かなくなるため、D1を使うこのファイルで適用する
beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(seedEngagementPlatformSample);

describe('イベントサーバーのモジュールの一覧へのエンゲージメントの登録', () => {
  test('エンゲージメントの共通の束縛を1つだけ持つ', () => {
    expect(
      MODULES.filter(({ name }) => name === 'engagement-platform'),
    ).toHaveLength(1);
  });
});

describe.each(INVOCATION_KINDS)(
  'イベントサーバーのエンゲージメントの共通の束縛(%s)',
  (kind) => {
    test('処理単位のコンテナから束縛した8つの識別子をD1の実装に解決する', () => {
      const container = createContainer(kind);

      for (const [identifier, implementation] of IMPLEMENTATIONS) {
        expect(container.get(identifier)).toBeInstanceOf(implementation);
      }
    });

    test('処理単位のコンテナから解決した出力の部品で、本人のコメントと無効化の印付きの評価を引ける', async () => {
      const container = createContainer(kind);

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
  },
);
