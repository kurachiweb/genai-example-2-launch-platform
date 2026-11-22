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
import { IDENTITY_PLATFORM_TYPES } from '../../lib/core/identity/identifiers.ts';
import type { AccountExport } from '../../lib/core/identity/ports.ts';
import { INQUIRY_EXPORT_TYPES } from '../../lib/core/inquiry/identifiers.ts';
import type { InquiryExport } from '../../lib/core/inquiry/ports.ts';
import { MATCH_PLATFORM_TYPES } from '../../lib/core/match/identifiers.ts';
import type { MatchExport, UpvoteExport } from '../../lib/core/match/ports.ts';
import { MEDIA_TYPES } from '../../lib/core/media/identifiers.ts';
import type { MediaFiles } from '../../lib/core/media/ports.ts';
import { NOTIFICATIONS_PLATFORM_TYPES } from '../../lib/core/notifications/identifiers.ts';
import type { NotificationSettingsExport } from '../../lib/core/notifications/ports.ts';
import { PAYMENTS_TYPES } from '../../lib/core/payments/identifiers.ts';
import type { PaymentHistoryExport } from '../../lib/core/payments/ports.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../lib/core/product/identifiers.ts';
import type {
  LaunchExport,
  ProductDirectory,
  ProductExport,
} from '../../lib/core/product/ports.ts';
import { PROFILE_PLATFORM_TYPES } from '../../lib/core/profile/identifiers.ts';
import type {
  FollowExport,
  ProfileExport,
} from '../../lib/core/profile/ports.ts';
import { PUBLIC_API_PLATFORM_TYPES } from '../../lib/core/public-api/identifiers.ts';
import type { ApiKeyExport } from '../../lib/core/public-api/ports.ts';
import { REPORTING_PLATFORM_TYPES } from '../../lib/core/reporting/identifiers.ts';
import type { ReportExport } from '../../lib/core/reporting/ports.ts';
import { SPONSORSHIP_PLATFORM_TYPES } from '../../lib/core/sponsorship/identifiers.ts';
import type { SponsorshipExport } from '../../lib/core/sponsorship/ports.ts';
import { ULTRAS_TYPES } from '../../lib/core/ultras/identifiers.ts';
import type { UltrasPlanExport } from '../../lib/core/ultras/ports.ts';
import { WEEK_TOURNAMENT_TYPES } from '../../lib/core/week-tournament/identifiers.ts';
import type { WeekAwardExport } from '../../lib/core/week-tournament/ports.ts';
import { YEAR_TOURNAMENT_TYPES } from '../../lib/core/year-tournament/identifiers.ts';
import type { YearAwardExport } from '../../lib/core/year-tournament/ports.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  after,
  clearEngagementTables,
  insertLaunch,
  insertProduct,
  insertRatings,
  insertUser,
  productIdOf,
  T0,
  userIdOf,
} from '../../lib/workers/engagement/testing/engagement-fixtures.ts';
import { MODULES } from './modules.ts';

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const INVOCATION_KINDS = ['fetch', 'queue'] as const;

interface UpstreamContract<T> {
  readonly name: string;
  readonly identifier: symbol;
  readonly methods: readonly (keyof T & string)[];
}

function contractOf<T>(
  name: string,
  identifier: symbol,
  ...methods: readonly (keyof T & string)[]
): UpstreamContract<T> {
  return { name, identifier, methods };
}

const UPSTREAM_CONTRACTS: readonly UpstreamContract<never>[] = [
  contractOf<AccountExport>(
    'AccountExport',
    IDENTITY_PLATFORM_TYPES.AccountExport,
    'find',
  ),
  contractOf<UltrasPlanExport>(
    'UltrasPlanExport',
    ULTRAS_TYPES.UltrasPlanExport,
    'find',
  ),
  contractOf<NotificationSettingsExport>(
    'NotificationSettingsExport',
    NOTIFICATIONS_PLATFORM_TYPES.NotificationSettingsExport,
    'find',
  ),
  contractOf<ApiKeyExport>(
    'ApiKeyExport',
    PUBLIC_API_PLATFORM_TYPES.ApiKeyExport,
    'listByUser',
  ),
  contractOf<ProfileExport>(
    'ProfileExport',
    PROFILE_PLATFORM_TYPES.ProfileExport,
    'find',
  ),
  contractOf<FollowExport>(
    'FollowExport',
    PROFILE_PLATFORM_TYPES.FollowExport,
    'listFollowing',
  ),
  contractOf<ProductExport>(
    'ProductExport',
    PRODUCT_PLATFORM_TYPES.ProductExport,
    'listByUser',
  ),
  contractOf<LaunchExport>(
    'LaunchExport',
    PRODUCT_PLATFORM_TYPES.LaunchExport,
    'listByUser',
  ),
  contractOf<ProductDirectory>(
    'ProductDirectory',
    PRODUCT_PLATFORM_TYPES.ProductDirectory,
    'findSummaries',
  ),
  contractOf<MatchExport>(
    'MatchExport',
    MATCH_PLATFORM_TYPES.MatchExport,
    'listForLaunches',
  ),
  contractOf<UpvoteExport>(
    'UpvoteExport',
    MATCH_PLATFORM_TYPES.UpvoteExport,
    'listByUser',
  ),
  contractOf<WeekAwardExport>(
    'WeekAwardExport',
    WEEK_TOURNAMENT_TYPES.WeekAwardExport,
    'listForLaunches',
  ),
  contractOf<YearAwardExport>(
    'YearAwardExport',
    YEAR_TOURNAMENT_TYPES.YearAwardExport,
    'listForLaunches',
  ),
  contractOf<CommentExport>(
    'CommentExport',
    ENGAGEMENT_PLATFORM_TYPES.CommentExport,
    'listByUser',
  ),
  contractOf<RatingExport>(
    'RatingExport',
    ENGAGEMENT_PLATFORM_TYPES.RatingExport,
    'listByUser',
  ),
  contractOf<ReportExport>(
    'ReportExport',
    REPORTING_PLATFORM_TYPES.ReportExport,
    'listPage',
  ),
  contractOf<InquiryExport>(
    'InquiryExport',
    INQUIRY_EXPORT_TYPES.InquiryExport,
    'listPage',
  ),
  contractOf<SponsorshipExport>(
    'SponsorshipExport',
    SPONSORSHIP_PLATFORM_TYPES.SponsorshipExport,
    'listByUser',
  ),
  contractOf<PaymentHistoryExport>(
    'PaymentHistoryExport',
    PAYMENTS_TYPES.PaymentHistoryExport,
    'listAll',
  ),
  contractOf<MediaFiles>(
    'MediaFiles',
    MEDIA_TYPES.MediaFiles,
    'findMany',
    'openContent',
  ),
];

const MEMBER = 2;
const PRODUCT = 1;
const OTHER_PRODUCT = 2;
const LAUNCH = 1;

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

beforeEach(async () => {
  await clearEngagementTables();
  await insertUser(1, { emailVerifiedAt: T0 });
  await insertUser(MEMBER, { emailVerifiedAt: T0 });
  await insertProduct(PRODUCT, 1);
  await insertProduct(OTHER_PRODUCT, 1);
  await insertLaunch(LAUNCH, PRODUCT);
  await insertRatings([
    {
      index: 1,
      product: PRODUCT,
      user: MEMBER,
      score: 4,
      columns: { createdAt: after(1), updatedAt: after(1) },
    },
    {
      index: 2,
      product: OTHER_PRODUCT,
      user: MEMBER,
      score: 2,
      columns: {
        createdAt: after(2),
        updatedAt: after(2),
        invalidatedAt: after(3),
      },
    },
  ]);
});

describe('データエクスポートが使う上流の出力用の部品のイベントサーバーでの解決', () => {
  test('設計の依存の一覧と同じ19の部品(アカウントと出力用の部品18)とファイルの照会を検査する', () => {
    expect(UPSTREAM_CONTRACTS).toHaveLength(20);
    expect(
      new Set(UPSTREAM_CONTRACTS.map(({ identifier }) => identifier)).size,
    ).toBe(20);
  });
});

describe.each(INVOCATION_KINDS)(
  'イベントサーバーの上流の出力用の部品(%s)',
  (kind) => {
    test.each(UPSTREAM_CONTRACTS)(
      '処理単位のコンテナから$nameを解決し、契約の操作を持つ',
      ({ identifier, methods }) => {
        const container = createContainer(kind);

        const component = container.get<Record<string, unknown>>(identifier);

        expect(component).toBeTypeOf('object');
        for (const method of methods) {
          expect(component[method], method).toBeTypeOf('function');
        }
      },
    );

    test('処理単位のコンテナから解決したRatingExportは、無効化した評価のinvalidatedByAdminを真、無効化していない評価を偽で返す', async () => {
      const container = createContainer(kind);
      const ratingExport = container.get<RatingExport>(
        ENGAGEMENT_PLATFORM_TYPES.RatingExport,
      );

      const records = await ratingExport.listByUser(userIdOf(MEMBER));

      expect(
        records.map(({ productId, score, invalidatedByAdmin }) => ({
          productId,
          score,
          invalidatedByAdmin,
        })),
      ).toEqual([
        {
          productId: productIdOf(PRODUCT),
          score: 4,
          invalidatedByAdmin: false,
        },
        {
          productId: productIdOf(OTHER_PRODUCT),
          score: 2,
          invalidatedByAdmin: true,
        },
      ]);
    });
  },
);
