import { beforeEach, describe, expect, test } from 'vitest';

import type { AdminRole } from '../../../../../common-lib/admin/admin-roles.ts';
import { moderationWeeklyStatistics } from '../../../../../db/schema/moderation/moderation-weekly-statistics.ts';
import { parseBusinessDate } from '../../../../../lib/core/time/business-time.ts';
import { issueAdminSession } from '../../../../../test/support/admin-graphql-harness.ts';
import {
  createGraphQLGateway,
  type GatewayCallOptions,
} from '../../../../../test/support/graphql-gateway.ts';
import { codesOf } from '../../../../../test/support/payments-graphql-operations.ts';
import type { WeeklyStatisticsRow } from '../../../../application/moderation/ports.ts';
import {
  adminIdOf,
  clearAdminTables,
  db,
  insertAdmin,
} from '../../../../infrastructure/admin/testing/admin-store-fixtures.ts';
import { D1WeeklyStatisticsStore } from '../../../../infrastructure/moderation/d1-weekly-statistics-store.ts';
import { mediaSchemaModule } from '../media/index.ts';
import { paymentsSchemaModule } from '../payments/index.ts';
import { moderationSchemaModule } from './index.ts';

interface AdminStatisticsWeekFields {
  readonly weekStart: string;
  readonly finalized: boolean;
  readonly netRevenue: { readonly amount: number; readonly currency: string };
  readonly users: number;
  readonly products: number;
  readonly qualifierMatches: number;
  readonly upvotes: number;
}

interface AdminWeeklyStatisticsFields {
  readonly weeks: readonly AdminStatisticsWeekFields[];
  readonly lastComputedAt: string | null;
}

const ADMIN_WEEKLY_STATISTICS = /* GraphQL */ `
  query AdminWeeklyStatistics {
    adminWeeklyStatistics {
      weeks {
        weekStart
        finalized
        netRevenue {
          amount
          currency
        }
        users
        products
        qualifierMatches
        upvotes
      }
      lastComputedAt
    }
  }
`;

const gateway = createGraphQLGateway({
  documents: [ADMIN_WEEKLY_STATISTICS],
  schemaModules: [
    paymentsSchemaModule,
    mediaSchemaModule,
    moderationSchemaModule,
  ],
});

const ADMIN_ROLES: readonly (readonly [number, AdminRole])[] = [
  [1, 'super_admin'],
  [2, 'moderator'],
  [3, 'viewer'],
];

const sessionTokens = new Map<AdminRole, string>();

const asRole = (role: AdminRole): GatewayCallOptions => ({
  caller: 'admin',
  sessionToken: sessionTokens.get(role),
});

const FINALIZED_AT = new Date('2026-11-16T12:21:00.000Z');
const COMPUTED_AT = new Date('2026-11-19T12:21:00.000Z');

const PREVIOUS_WEEK: WeeklyStatisticsRow = {
  weekStart: parseBusinessDate('2026-11-09'),
  netRevenue: -250,
  usersTotal: 118,
  productsTotal: 44,
  qualifierMatches: 21,
  upvotes: 702,
  finalized: true,
  computedAt: FINALIZED_AT,
};

const CURRENT_WEEK: WeeklyStatisticsRow = {
  weekStart: parseBusinessDate('2026-11-16'),
  netRevenue: 12_345,
  usersTotal: 120,
  productsTotal: 45,
  qualifierMatches: 9,
  upvotes: 318,
  finalized: false,
  computedAt: COMPUTED_AT,
};

function fetchWeeklyStatistics(options?: GatewayCallOptions) {
  return gateway.call<{
    adminWeeklyStatistics: AdminWeeklyStatisticsFields | null;
  }>(ADMIN_WEEKLY_STATISTICS, {}, options);
}

beforeEach(async () => {
  await db.delete(moderationWeeklyStatistics);
  await clearAdminTables();
  sessionTokens.clear();
  for (const [index, role] of ADMIN_ROLES) {
    await insertAdmin(index, { role });
    const issued = await issueAdminSession(adminIdOf(index));
    sessionTokens.set(role, issued.token);
  }
});

describe('adminWeeklyStatistics', () => {
  test('利用者側の呼び出し元からはforbiddenで拒否する', async () => {
    await new D1WeeklyStatisticsStore(db).upsert([PREVIOUS_WEEK]);

    const response = await fetchWeeklyStatistics();

    expect(codesOf(response)).toEqual(['forbidden']);
    expect(response.data?.adminWeeklyStatistics ?? null).toBeNull();
  });

  test('管理者のセッションが無ければunauthenticatedで拒否する', async () => {
    const response = await fetchWeeklyStatistics({ caller: 'admin' });

    expect(codesOf(response)).toEqual(['unauthenticated']);
  });

  test.each(['viewer', 'moderator', 'super_admin'] as const)(
    '%sの管理者に、保存した週を古い順に業務日付・確定の有無・税込の純収益の金額・4つの値で返し、最後の集計日時を添える',
    async (role) => {
      await new D1WeeklyStatisticsStore(db).upsert([
        PREVIOUS_WEEK,
        CURRENT_WEEK,
      ]);

      const response = await fetchWeeklyStatistics(asRole(role));

      expect(response.errors).toBeUndefined();
      expect(response.data?.adminWeeklyStatistics).toStrictEqual({
        weeks: [
          {
            weekStart: '2026-11-09',
            finalized: true,
            netRevenue: { amount: -250, currency: 'usd' },
            users: 118,
            products: 44,
            qualifierMatches: 21,
            upvotes: 702,
          },
          {
            weekStart: '2026-11-16',
            finalized: false,
            netRevenue: { amount: 12_345, currency: 'usd' },
            users: 120,
            products: 45,
            qualifierMatches: 9,
            upvotes: 318,
          },
        ],
        lastComputedAt: COMPUTED_AT.toISOString(),
      });
    },
  );

  test('集計した週が無ければ空の週と最後の集計日時nullを返す', async () => {
    const response = await fetchWeeklyStatistics(asRole('viewer'));

    expect(response.errors).toBeUndefined();
    expect(response.data?.adminWeeklyStatistics).toStrictEqual({
      weeks: [],
      lastComputedAt: null,
    });
  });
});
