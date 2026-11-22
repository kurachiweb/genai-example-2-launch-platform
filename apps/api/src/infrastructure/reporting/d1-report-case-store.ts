import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { OpenReportCaseStatus } from '../../../common-lib/reporting/report-case-rules.ts';
import type { Database } from '../../../db/client.ts';
import { reportCases } from '../../../db/schema/reporting/report-cases.ts';
import { reportCategories } from '../../../db/schema/reporting/report-categories.ts';
import { reports } from '../../../db/schema/reporting/reports.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { invalidCursorError } from '../../../lib/core/errors/invalid-cursor.ts';
import { UPPERCASE_ULID_SOURCE } from '../../../lib/core/ids/uppercase-ulid.ts';
import type {
  ProductReportSummary,
  ReportCaseFilter,
  ReportCaseRecord,
  ReportCaseReportRecord,
  ReportCaseStore,
  ReportCategoryCount,
  UnhandledReportCount,
} from '../../application/reporting/ports.ts';

interface CursorPosition {
  readonly at: Date;
  readonly id: string;
}

interface CaseAggregate {
  readonly reportCount: number;
  readonly firstReportedAt: Date;
  readonly categoryCounts: readonly ReportCategoryCount[];
}

const CURSOR_PATTERN = new RegExp(
  String.raw`^(\d{1,15}):(${UPPERCASE_ULID_SOURCE})$`,
  'u',
);

const BASE64URL_OPTIONS = {
  alphabet: 'base64url',
  omitPadding: true,
} as const;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });

const CASE_COLUMNS = {
  caseId: reportCases.id,
  targetKind: reportCases.targetKind,
  targetId: reportCases.targetId,
  targetDetachedAt: reportCases.targetDetachedAt,
  targetOwnerUserId: reportCases.targetOwnerUserId,
  productId: reportCases.productId,
  status: reportCases.status,
  statusChangedAt: reportCases.statusChangedAt,
  infringementReportedAt: reportCases.infringementReportedAt,
  closedAt: reportCases.closedAt,
  resolution: reportCases.resolution,
  closingReason: reportCases.closingReason,
  lastInquiredAt: reportCases.lastInquiredAt,
  lastInquiryMessage: reportCases.lastInquiryMessage,
  lastReportedAt: reportCases.lastReportedAt,
};

type CaseRow = Omit<
  ReportCaseRecord,
  'reportCount' | 'firstReportedAt' | 'categoryCounts'
>;

function encodeCursor(position: CursorPosition): string {
  return textEncoder
    .encode(`${String(position.at.getTime())}:${position.id}`)
    .toBase64(BASE64URL_OPTIONS);
}

function decodeCursorText(cursor: string): string | undefined {
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.fromBase64(cursor, { alphabet: 'base64url' });
  } catch {
    return undefined;
  }
  // デコードは空白・パディング・末尾の余りのビットを許すため、再エンコードして同じ表記のものだけを受け付ける
  if (bytes.toBase64(BASE64URL_OPTIONS) !== cursor) {
    return undefined;
  }
  try {
    return textDecoder.decode(bytes);
  } catch {
    return undefined;
  }
}

function decodeCursor(cursor: string): CursorPosition {
  const [, at, id] = CURSOR_PATTERN.exec(decodeCursorText(cursor) ?? '') ?? [];
  if (at === undefined || id === undefined) {
    throw invalidCursorError();
  }
  return { at: new Date(Number(at)), id };
}

// (last_reported_at DESC, id DESC)の並びで、カーソルの位置より後ろの案件だけにする
function afterCursor(cursor: string | undefined): SQL | undefined {
  if (cursor === undefined) {
    return undefined;
  }
  const position = decodeCursor(cursor);
  return or(
    lt(reportCases.lastReportedAt, position.at),
    and(
      eq(reportCases.lastReportedAt, position.at),
      lt(reportCases.id, position.id),
    ),
  );
}

const visibleReportOf = (caseId: string | typeof reportCases.id) =>
  and(eq(reports.caseId, caseId), isNull(reports.deletedAt));

// カテゴリと受付期間は同じ通報で満たす。退会で論理削除した通報だけの案件は表示する通報が無いため、条件が無くても通報の存在を求める
function hasVisibleReport(
  db: Database,
  filter: Pick<
    ReportCaseFilter,
    'categoryId' | 'reportedFrom' | 'reportedBefore'
  > = {},
): SQL {
  return exists(
    db
      .select({ one: sql`1` })
      .from(reports)
      .where(
        and(
          visibleReportOf(reportCases.id),
          filter.categoryId === undefined
            ? undefined
            : eq(reports.categoryId, filter.categoryId),
          filter.reportedFrom === undefined
            ? undefined
            : gte(reports.reportedAt, filter.reportedFrom),
          filter.reportedBefore === undefined
            ? undefined
            : lt(reports.reportedAt, filter.reportedBefore),
        ),
      ),
  );
}

function toRecord(
  row: CaseRow,
  aggregate: CaseAggregate | undefined,
): ReportCaseRecord {
  return {
    ...row,
    reportCount: aggregate?.reportCount ?? 0,
    firstReportedAt: aggregate?.firstReportedAt ?? row.lastReportedAt,
    categoryCounts: aggregate?.categoryCounts ?? [],
  };
}

@injectable()
export class D1ReportCaseStore implements ReportCaseStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async search(
    filter: ReportCaseFilter,
    page: { readonly after?: string; readonly limit: number },
  ): Promise<{
    readonly items: readonly ReportCaseRecord[];
    readonly nextCursor: string | null;
  }> {
    const rows = await this.db
      .select(CASE_COLUMNS)
      .from(reportCases)
      .where(
        and(
          filter.status === undefined
            ? undefined
            : eq(reportCases.status, filter.status),
          filter.targetKind === undefined
            ? undefined
            : eq(reportCases.targetKind, filter.targetKind),
          hasVisibleReport(this.db, filter),
          afterCursor(page.after),
        ),
      )
      .orderBy(desc(reportCases.lastReportedAt), desc(reportCases.id))
      .limit(page.limit + 1);
    const pageRows = rows.slice(0, page.limit);
    const last = pageRows.at(-1);
    const aggregates = await this.aggregatesOf(
      pageRows.map((row) => row.caseId),
    );
    return {
      items: pageRows.map((row) => toRecord(row, aggregates.get(row.caseId))),
      nextCursor:
        rows.length > page.limit && last !== undefined
          ? encodeCursor({ at: last.lastReportedAt, id: last.caseId })
          : null,
    };
  }

  async find(caseId: string): Promise<ReportCaseRecord | undefined> {
    const [row] = await this.db
      .select(CASE_COLUMNS)
      .from(reportCases)
      .where(and(eq(reportCases.id, caseId), hasVisibleReport(this.db)));
    if (row === undefined) {
      return undefined;
    }
    const aggregates = await this.aggregatesOf([caseId]);
    return toRecord(row, aggregates.get(caseId));
  }

  async listReports(
    caseId: string,
  ): Promise<readonly ReportCaseReportRecord[]> {
    return this.db
      .select({
        reportId: reports.id,
        categoryId: reports.categoryId,
        categoryName: reportCategories.name,
        reason: reports.reason,
        reportedAt: reports.reportedAt,
        reporterUserId: reports.reporterUserId,
        hasContact: sql<boolean>`${isNotNull(reports.contactEmail)}`.mapWith(
          Boolean,
        ),
      })
      .from(reports)
      .innerJoin(reportCategories, eq(reportCategories.id, reports.categoryId))
      .where(visibleReportOf(caseId))
      .orderBy(asc(reports.reportedAt), asc(reports.id));
  }

  async countUnhandled(): Promise<UnhandledReportCount> {
    const [row] = await this.db
      .select({
        open: count(),
        infringementOpen:
          sql<number>`coalesce(sum(${isNotNull(reportCases.infringementReportedAt)}), 0)`.mapWith(
            Number,
          ),
      })
      .from(reportCases)
      .where(and(eq(reportCases.status, 'open'), hasVisibleReport(this.db)));
    return {
      open: row?.open ?? 0,
      infringementOpen: row?.infringementOpen ?? 0,
    };
  }

  // 対象がプロダクトの案件はproduct_idに対象のIDを持つため、その索引で絞る
  async productSummary(productId: string): Promise<ProductReportSummary> {
    const productCase = and(
      eq(reportCases.productId, productId),
      eq(reportCases.targetKind, 'product'),
    );
    const [[counted], [openCase]] = await Promise.all([
      this.db
        .select({ reportCount: count() })
        .from(reports)
        .innerJoin(reportCases, eq(reportCases.id, reports.caseId))
        .where(and(productCase, isNull(reports.deletedAt))),
      this.db
        .select({
          caseId: reportCases.id,
          status: sql<OpenReportCaseStatus>`${reportCases.status}`,
        })
        .from(reportCases)
        .where(
          and(
            productCase,
            isNull(reportCases.closedAt),
            hasVisibleReport(this.db),
          ),
        )
        .limit(1),
    ]);
    return {
      reportCount: counted?.reportCount ?? 0,
      openCase: openCase ?? null,
    };
  }

  // ページの案件の通報をカテゴリごとに1回で数え、カテゴリの現在の名前を結合する
  private async aggregatesOf(
    caseIds: readonly string[],
  ): Promise<ReadonlyMap<string, CaseAggregate>> {
    if (caseIds.length === 0) {
      return new Map();
    }
    const rows = await this.db
      .select({
        caseId: reports.caseId,
        categoryId: reports.categoryId,
        name: reportCategories.name,
        count: count(),
        firstReportedAt: sql<number>`min(${reports.reportedAt})`.mapWith(
          reports.reportedAt,
        ),
      })
      .from(reports)
      .innerJoin(reportCategories, eq(reportCategories.id, reports.categoryId))
      .where(
        and(inArray(reports.caseId, [...caseIds]), isNull(reports.deletedAt)),
      )
      .groupBy(reports.caseId, reports.categoryId)
      .orderBy(desc(count()), asc(reports.categoryId));
    const aggregates = new Map<string, CaseAggregate>();
    for (const row of rows) {
      const current = aggregates.get(row.caseId);
      aggregates.set(row.caseId, {
        reportCount: (current?.reportCount ?? 0) + row.count,
        firstReportedAt:
          current === undefined || row.firstReportedAt < current.firstReportedAt
            ? row.firstReportedAt
            : current.firstReportedAt,
        categoryCounts: [
          ...(current?.categoryCounts ?? []),
          { categoryId: row.categoryId, name: row.name, count: row.count },
        ],
      });
    }
    return aggregates;
  }
}
