import { and, asc, eq, gt } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { notDeleted } from '../../../db/schema/_shared/columns.ts';
import { reportCases } from '../../../db/schema/reporting/report-cases.ts';
import { reports } from '../../../db/schema/reporting/reports.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import { invalidCursorError } from '../../core/errors/invalid-cursor.ts';
import { isUppercaseUlid } from '../../core/ids/uppercase-ulid.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../core/product/identifiers.ts';
import type { ProductDirectory } from '../../core/product/ports.ts';
import { PROFILE_PLATFORM_TYPES } from '../../core/profile/identifiers.ts';
import type { UserProfileDirectory } from '../../core/profile/ports.ts';
import type {
  ReportExport,
  ReportExportRecord,
} from '../../core/reporting/ports.ts';

interface ReportRow {
  readonly id: string;
  readonly targetKind: ReportExportRecord['targetType'];
  readonly targetId: string | null;
  readonly category: string;
  readonly reason: string;
  readonly reportedAt: Date;
}

function afterReport(after: string | undefined) {
  if (after === undefined) {
    return undefined;
  }
  if (!isUppercaseUlid(after)) {
    throw invalidCursorError();
  }
  return gt(reports.id, after);
}

function targetIdsOf(
  rows: readonly ReportRow[],
  kind: ReportExportRecord['targetType'],
): string[] {
  return [
    ...new Set(
      rows.flatMap((row) =>
        row.targetKind === kind && row.targetId !== null ? [row.targetId] : [],
      ),
    ),
  ];
}

@injectable()
export class D1ReportExport implements ReportExport {
  constructor(
    @inject(PLATFORM_TYPES.Database) private readonly db: Database,
    @inject(PROFILE_PLATFORM_TYPES.UserProfileDirectory)
    private readonly profiles: UserProfileDirectory,
    @inject(PRODUCT_PLATFORM_TYPES.ProductDirectory)
    private readonly products: ProductDirectory,
  ) {}

  async listPage(input: {
    readonly after?: string;
    readonly userId: string;
    readonly limit: number;
  }): Promise<{
    readonly records: readonly ReportExportRecord[];
    readonly nextAfter: string | null;
  }> {
    const rows = await this.db
      .select({
        id: reports.id,
        targetKind: reportCases.targetKind,
        targetId: reportCases.targetId,
        category: reports.categoryName,
        reason: reports.reason,
        reportedAt: reports.reportedAt,
      })
      .from(reports)
      .innerJoin(reportCases, eq(reportCases.id, reports.caseId))
      .where(
        and(
          eq(reports.reporterUserId, input.userId),
          notDeleted(reports.deletedAt),
          afterReport(input.after),
        ),
      )
      .orderBy(asc(reports.id))
      .limit(input.limit + 1);
    const page = rows.slice(0, input.limit);
    const refs = await this.resolveRefs(page);
    return {
      records: page.map((row) => ({
        id: row.id,
        targetType: row.targetKind,
        targetRef: refs(row) ?? null,
        category: row.category,
        reason: row.reason,
        createdAt: row.reportedAt,
      })),
      nextAfter: rows.length > input.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  private async resolveRefs(
    rows: readonly ReportRow[],
  ): Promise<(row: ReportRow) => string | undefined> {
    const userIds = targetIdsOf(rows, 'user');
    const productIds = targetIdsOf(rows, 'product');
    const [users, products] = await Promise.all([
      userIds.length === 0
        ? new Map<string, { readonly handle: string }>()
        : this.profiles.findSummaries(userIds, 'not-withdrawn'),
      productIds.length === 0
        ? new Map<string, { readonly handle: string }>()
        : this.products.findSummaries(productIds, 'not-deleted'),
    ]);
    return (row) => {
      if (row.targetId === null) {
        return undefined;
      }
      switch (row.targetKind) {
        case 'user':
          return users.get(row.targetId)?.handle;
        case 'product':
          return products.get(row.targetId)?.handle;
        case 'comment':
          return row.targetId;
      }
    };
  }
}
