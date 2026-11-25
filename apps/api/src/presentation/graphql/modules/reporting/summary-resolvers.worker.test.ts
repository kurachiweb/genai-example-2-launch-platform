import { beforeEach, describe, expect, test } from 'vitest';

import type { AdminRole } from '../../../../../common-lib/admin/admin-roles.ts';
import type { ReportCaseStatus } from '../../../../../common-lib/reporting/report-case-rules.ts';
import {
  REPORT_CATEGORY_OTHER_ID,
  REPORT_CATEGORY_OTHER_NAME,
} from '../../../../../common-lib/reporting/report-rules.ts';
import { reportCases } from '../../../../../db/schema/reporting/report-cases.ts';
import { reports } from '../../../../../db/schema/reporting/reports.ts';
import { issueAdminSession } from '../../../../../test/support/admin-graphql-harness.ts';
import {
  createGraphQLGateway,
  type GatewayCallOptions,
} from '../../../../../test/support/graphql-gateway.ts';
import {
  codesOf,
  detailsOf,
} from '../../../../../test/support/payments-graphql-operations.ts';
import {
  adminIdOf,
  clearAdminTables,
  db,
  insertAdmin,
} from '../../../../infrastructure/admin/testing/admin-store-fixtures.ts';
import { reportingSchemaModule } from './index.ts';

interface UnhandledSummaryFields {
  readonly open: number;
  readonly infringementOpen: number;
}

interface ProductSummaryFields {
  readonly reportCount: number;
  readonly openCase: { readonly id: string; readonly status: string } | null;
}

const ADMIN_UNHANDLED_REPORT_SUMMARY = /* GraphQL */ `
  query AdminUnhandledReportSummary {
    adminUnhandledReportSummary {
      open
      infringementOpen
    }
  }
`;

const ADMIN_PRODUCT_REPORT_SUMMARY = /* GraphQL */ `
  query AdminProductReportSummary($productId: ID!) {
    adminProductReportSummary(productId: $productId) {
      reportCount
      openCase {
        id
        status
      }
    }
  }
`;

const gateway = createGraphQLGateway({
  documents: [ADMIN_UNHANDLED_REPORT_SUMMARY, ADMIN_PRODUCT_REPORT_SUMMARY],
  schemaModules: [reportingSchemaModule],
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

const asClient = (role: AdminRole): GatewayCallOptions => ({
  caller: 'client',
  sessionToken: sessionTokens.get(role),
});

const T0 = new Date('2026-11-22T00:00:00.000Z');

const idOf = (prefix: string, index: number): string =>
  `${prefix}${String(index).padStart(17, '0')}`;

const caseIdOf = (index: number): string => idOf('01JE6CASE', index);

const reportIdOf = (index: number): string => idOf('01JE6RPRT', index);

const productIdOf = (index: number): string => idOf('01JE6PRDT', index);

const userIdOf = (index: number): string => idOf('01JE6USER', index);

type CaseRow = typeof reportCases.$inferInsert;

const CLOSED_COLUMNS: Readonly<Record<ReportCaseStatus, Partial<CaseRow>>> =
  Object.freeze({
    open: {},
    in_progress: {},
    resolved: { closedAt: T0, resolution: 'none', closingReason: '対応済' },
    rejected: { closedAt: T0, closingReason: '却下' },
  });

async function insertCase(
  index: number,
  target: Pick<CaseRow, 'targetKind' | 'targetId' | 'productId'>,
  status: ReportCaseStatus,
  columns: Partial<CaseRow> = {},
): Promise<void> {
  await db.insert(reportCases).values({
    id: caseIdOf(index),
    targetOwnerUserId: userIdOf(index),
    status,
    statusChangedAt: T0,
    lastReportedAt: T0,
    createdAt: T0,
    updatedAt: T0,
    ...target,
    ...CLOSED_COLUMNS[status],
    ...columns,
  });
}

const productTarget = (productIndex: number) => ({
  targetKind: 'product' as const,
  targetId: productIdOf(productIndex),
  productId: productIdOf(productIndex),
});

const commentTarget = (productIndex: number, commentIndex: number) => ({
  targetKind: 'comment' as const,
  targetId: idOf('01JE6CMNT', commentIndex),
  productId: productIdOf(productIndex),
});

const userTarget = (userIndex: number) => ({
  targetKind: 'user' as const,
  targetId: userIdOf(userIndex),
  productId: null,
});

async function insertReports(
  caseIndex: number,
  reportIndexes: readonly number[],
  columns: { readonly deletedAt?: Date } = {},
): Promise<void> {
  for (const index of reportIndexes) {
    await db.insert(reports).values({
      id: reportIdOf(index),
      caseId: caseIdOf(caseIndex),
      categoryId: REPORT_CATEGORY_OTHER_ID,
      categoryName: REPORT_CATEGORY_OTHER_NAME,
      reason: `通報の理由${String(index)}`,
      reportedAt: T0,
      createdAt: T0,
      updatedAt: T0,
      ...columns,
    });
  }
}

function fetchUnhandledSummary(options: GatewayCallOptions) {
  return gateway.call<{
    adminUnhandledReportSummary: UnhandledSummaryFields | null;
  }>(ADMIN_UNHANDLED_REPORT_SUMMARY, {}, options);
}

function fetchProductSummary(productId: string, options: GatewayCallOptions) {
  return gateway.call<{
    adminProductReportSummary: ProductSummaryFields | null;
  }>(ADMIN_PRODUCT_REPORT_SUMMARY, { productId }, options);
}

beforeEach(async () => {
  await db.batch([db.delete(reports), db.delete(reportCases)]);
  await clearAdminTables();
  sessionTokens.clear();
  for (const [index, role] of ADMIN_ROLES) {
    await insertAdmin(index, { role });
    const issued = await issueAdminSession(adminIdOf(index));
    sessionTokens.set(role, issued.token);
  }
});

describe('adminUnhandledReportSummary', () => {
  test.each(['viewer', 'moderator', 'super_admin'] as const)(
    '%sの管理者に、表示する通報のある未対応の案件の件数と、そのうち権利侵害の件数を返す',
    async (role) => {
      await insertCase(1, userTarget(1), 'open');
      await insertReports(1, [1]);
      await insertCase(2, productTarget(1), 'open', {
        infringementReportedAt: T0,
      });
      await insertReports(2, [2, 3]);
      await insertCase(3, productTarget(2), 'in_progress', {
        infringementReportedAt: T0,
      });
      await insertReports(3, [4]);
      await insertCase(4, productTarget(3), 'resolved');
      await insertReports(4, [5]);
      await insertCase(5, userTarget(2), 'open', {
        infringementReportedAt: T0,
      });
      await insertReports(5, [6], { deletedAt: T0 });

      const response = await fetchUnhandledSummary(asRole(role));

      expect(response.errors).toBeUndefined();
      expect(response.data?.adminUnhandledReportSummary).toStrictEqual({
        open: 2,
        infringementOpen: 1,
      });
    },
  );

  test('案件が無ければ両方0を返す', async () => {
    const response = await fetchUnhandledSummary(asRole('viewer'));

    expect(response.errors).toBeUndefined();
    expect(response.data?.adminUnhandledReportSummary).toStrictEqual({
      open: 0,
      infringementOpen: 0,
    });
  });

  test('利用者側の呼び出し元からはforbiddenで拒否する', async () => {
    const response = await fetchUnhandledSummary(asClient('super_admin'));

    expect(codesOf(response)).toEqual(['forbidden']);
    expect(response.data?.adminUnhandledReportSummary ?? null).toBeNull();
  });

  test('管理者のセッションが無ければunauthenticatedで拒否する', async () => {
    const response = await fetchUnhandledSummary({ caller: 'admin' });

    expect(codesOf(response)).toEqual(['unauthenticated']);
  });
});

describe('adminProductReportSummary', () => {
  test.each(['viewer', 'moderator', 'super_admin'] as const)(
    '%sの管理者に、対象がそのプロダクトの案件の論理削除していない通報の累計と、未完了の案件のIDと状態を返す',
    async (role) => {
      await insertCase(1, productTarget(1), 'resolved');
      await insertReports(1, [1, 2]);
      await insertReports(1, [3], { deletedAt: T0 });
      await insertCase(2, productTarget(1), 'in_progress');
      await insertReports(2, [4]);
      await insertCase(3, commentTarget(1, 1), 'open');
      await insertReports(3, [5]);
      await insertCase(4, productTarget(2), 'open');
      await insertReports(4, [6]);

      const response = await fetchProductSummary(productIdOf(1), asRole(role));

      expect(response.errors).toBeUndefined();
      expect(response.data?.adminProductReportSummary).toStrictEqual({
        reportCount: 3,
        openCase: { id: caseIdOf(2), status: 'IN_PROGRESS' },
      });
    },
  );

  test('未対応の案件は状態OPENで返す', async () => {
    await insertCase(1, productTarget(1), 'open');
    await insertReports(1, [1]);

    const response = await fetchProductSummary(
      productIdOf(1),
      asRole('viewer'),
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.adminProductReportSummary).toStrictEqual({
      reportCount: 1,
      openCase: { id: caseIdOf(1), status: 'OPEN' },
    });
  });

  test('完了した案件だけのプロダクトには未完了の案件nullを返し、通報の無いプロダクトには件数0を返す', async () => {
    await insertCase(1, productTarget(1), 'rejected');
    await insertReports(1, [1]);

    const closed = await fetchProductSummary(productIdOf(1), asRole('viewer'));
    const unreported = await fetchProductSummary(
      productIdOf(9),
      asRole('viewer'),
    );

    expect(closed.data?.adminProductReportSummary).toStrictEqual({
      reportCount: 1,
      openCase: null,
    });
    expect(unreported.data?.adminProductReportSummary).toStrictEqual({
      reportCount: 0,
      openCase: null,
    });
  });

  test('形式の違うプロダクトのIDをプロダクトが見つからない文言のvalidation_errorで拒否する', async () => {
    const response = await fetchProductSummary('not-a-ulid', asRole('viewer'));

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({
        field: 'productId',
        message: 'プロダクトが見つかりません。',
      }),
    ]);
  });

  test('利用者側の呼び出し元をIDの検証より前にforbiddenで拒否する', async () => {
    const response = await fetchProductSummary(
      'not-a-ulid',
      asClient('super_admin'),
    );

    expect(codesOf(response)).toEqual(['forbidden']);
    expect(detailsOf(response)).toEqual([]);
  });

  test('管理者のセッションが無ければunauthenticatedで拒否する', async () => {
    const response = await fetchProductSummary(productIdOf(1), {
      caller: 'admin',
    });

    expect(codesOf(response)).toEqual(['unauthenticated']);
  });
});
