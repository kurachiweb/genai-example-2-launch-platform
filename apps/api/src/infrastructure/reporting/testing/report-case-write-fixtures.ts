import { env } from 'cloudflare:workers';
import { asc, eq, like } from 'drizzle-orm';

import {
  REPORT_REJECT_ACTION,
  REPORT_RESOLVE_ACTION,
  REPORT_STATUS_CHANGE_ACTION,
} from '../../../../common-lib/admin/audit-actions/content-reporting.ts';
import type { ReportCaseStatus } from '../../../../common-lib/reporting/report-case-rules.ts';
import {
  REPORT_CATEGORY_OTHER_ID,
  REPORT_CATEGORY_OTHER_NAME,
} from '../../../../common-lib/reporting/report-rules.ts';
import { createDatabase } from '../../../../db/client.ts';
import { adminAuditLogTargets } from '../../../../db/schema/admin/admin-audit-log-targets.ts';
import { adminAuditLogs } from '../../../../db/schema/admin/admin-audit-logs.ts';
import { users } from '../../../../db/schema/identity/users.ts';
import { moderationActions } from '../../../../db/schema/moderation/moderation-actions.ts';
import { reportCases } from '../../../../db/schema/reporting/report-cases.ts';
import { reports } from '../../../../db/schema/reporting/reports.ts';
import type { PreparedAuditEntry } from '../../../../lib/core/admin/audit-log.ts';
import type {
  CaseClosing,
  ReportCaseStatusChange,
} from '../../../application/reporting/ports.ts';
import type { MeasureCaseClosing } from '../../../application/reporting/report-case-closing-participation.ts';

export const db = createDatabase(env.DB);

export const T0 = new Date('2026-11-22T04:21:00.000Z');

export const AT = new Date(T0.getTime() + 60_000);

export const REASON = '規約に反しないと判断したため';

const OPERATOR_ADMIN_ID = '01JQ0ADM000000000000000001';

const REPORTER_ID_PREFIX = '01JF0RPTR';

export type CaseRow = typeof reportCases.$inferInsert;

type ReportRow = typeof reports.$inferInsert;

const pad = (index: number): string => String(index).padStart(17, '0');

export const caseIdOf = (index: number): string => `01JF0CASE${pad(index)}`;

export const reportIdOf = (index: number): string => `01JF0REPT${pad(index)}`;

const reporterIdOf = (index: number): string =>
  `${REPORTER_ID_PREFIX}${pad(index)}`;

export const productIdOf = (index: number): string => `01JF0PRDT${pad(index)}`;

const ownerIdOf = (index: number): string => `01JF0OWNR${pad(index)}`;

export const auditIdOf = (index: number): string => `01JF0AUDT${pad(index)}`;

export function openCaseOf(
  index: number,
  columns: Partial<CaseRow> = {},
): CaseRow {
  return {
    id: caseIdOf(index),
    targetKind: 'product',
    targetId: productIdOf(index),
    targetOwnerUserId: ownerIdOf(index),
    productId: productIdOf(index),
    status: 'open',
    statusChangedAt: T0,
    lastReportedAt: T0,
    createdAt: T0,
    updatedAt: T0,
    ...columns,
  };
}

export function measureResolvedColumns(): Partial<CaseRow> {
  return {
    status: 'resolved',
    statusChangedAt: T0,
    closedAt: T0,
    resolution: 'product.hide',
    resolutionActionId: '01JF0MACT00000000000000001',
    closingReason: '前の完了の理由',
    posterNoticeStatus: 'pending',
  };
}

export function rejectedColumns(): Partial<CaseRow> {
  return {
    status: 'rejected',
    statusChangedAt: T0,
    closedAt: T0,
    resolution: null,
    closingReason: '前の却下の理由',
    posterNoticeStatus: 'requested',
    posterNoticeRequestedAt: T0,
  };
}

export function detachedColumns(): Partial<CaseRow> {
  return {
    targetId: null,
    targetOwnerUserId: null,
    productId: null,
    targetDetachedAt: T0,
  };
}

export function guestReportOf(
  index: number,
  caseIndex: number,
  columns: Partial<ReportRow> = {},
): ReportRow {
  return {
    id: reportIdOf(index),
    caseId: caseIdOf(caseIndex),
    reporterUserId: null,
    contactEmail: `guest${String(index)}@mail.example`,
    categoryId: REPORT_CATEGORY_OTHER_ID,
    categoryName: REPORT_CATEGORY_OTHER_NAME,
    reason: `申出者の理由${String(index)}`,
    reportedAt: T0,
    createdAt: T0,
    updatedAt: T0,
    ...columns,
  };
}

export function memberReportOf(
  index: number,
  caseIndex: number,
  reporterIndex: number,
  columns: Partial<ReportRow> = {},
): ReportRow {
  return guestReportOf(index, caseIndex, {
    reporterUserId: reporterIdOf(reporterIndex),
    contactEmail: null,
    ...columns,
  });
}

export async function insertReporter(index: number): Promise<void> {
  await db.insert(users).values({
    id: reporterIdOf(index),
    pseudonymousId: `report-case-write-${String(index)}`,
    email: `reporter${String(index)}@mail.example`,
    passwordHash: 'pbkdf2-sha256$test',
    nickname: `申出者${String(index)}`,
    handle: `rcwreporter${String(index)}`,
    termsAgreedAt: T0,
    createdAt: T0,
    updatedAt: T0,
  });
}

export async function seed(
  cases: readonly CaseRow[],
  rows: readonly ReportRow[] = [],
): Promise<void> {
  for (const row of cases) {
    await db.insert(reportCases).values(row);
  }
  for (const row of rows) {
    await db.insert(reports).values(row);
  }
}

export function auditOf(
  index: number,
  action: string,
  caseId: string,
  detail: Readonly<Record<string, string>> = {},
): PreparedAuditEntry {
  return {
    id: auditIdOf(index),
    operatorAdminId: OPERATOR_ADMIN_ID,
    action,
    targetKind: 'report',
    targetIds: [caseId],
    reason: REASON,
    detail,
    occurredAt: AT,
  } as unknown as PreparedAuditEntry;
}

export function statusChangeOf(
  caseIndex: number,
  from: ReportCaseStatus,
  to: ReportCaseStatus,
  auditIndex = 1,
): ReportCaseStatusChange {
  const action =
    to === 'resolved'
      ? REPORT_RESOLVE_ACTION.name
      : to === 'rejected'
        ? REPORT_REJECT_ACTION.name
        : REPORT_STATUS_CHANGE_ACTION.name;
  return {
    caseId: caseIdOf(caseIndex),
    from,
    to,
    reason: REASON,
    at: AT,
    audit: auditOf(auditIndex, action, caseIdOf(caseIndex), {
      fromStatus: from,
      toStatus: to,
    }),
  };
}

export function closingOf(
  caseIndex: number,
  overrides: Partial<CaseClosing> = {},
): CaseClosing {
  return {
    caseId: caseIdOf(caseIndex),
    to: 'resolved',
    resolution: 'none',
    reason: REASON,
    posterNotice: 'none',
    at: AT,
    audit: auditOf(1, REPORT_RESOLVE_ACTION.name, caseIdOf(caseIndex), {
      resolution: 'none',
      mode: 'operation',
      fromStatus: 'open',
    }),
    ...overrides,
  };
}

export function measureClosingOf(caseIndex: number): MeasureCaseClosing {
  return {
    caseId: caseIdOf(caseIndex),
    to: 'resolved',
    resolution: 'product.hide',
    reason: REASON,
    posterNotice: 'none',
    at: AT,
    audit: auditOf(1, REPORT_RESOLVE_ACTION.name, caseIdOf(caseIndex), {
      resolution: 'product.hide',
      mode: 'operation',
      fromStatus: 'open',
    }),
  };
}

export async function readCase(index: number) {
  const [row] = await db
    .select()
    .from(reportCases)
    .where(eq(reportCases.id, caseIdOf(index)));
  return row;
}

export async function readCaseIds(): Promise<string[]> {
  const rows = await db
    .select({ id: reportCases.id })
    .from(reportCases)
    .orderBy(asc(reportCases.id));
  return rows.map(({ id }) => id);
}

export async function readReportRows() {
  return db.select().from(reports).orderBy(asc(reports.id));
}

export async function readNoticeStatuses(): Promise<Record<string, string>> {
  const rows = await readReportRows();
  return Object.fromEntries(
    rows.map(({ id, outcomeNoticeStatus }) => [id, outcomeNoticeStatus]),
  );
}

export async function readAudits() {
  const logs = await db
    .select()
    .from(adminAuditLogs)
    .orderBy(asc(adminAuditLogs.id));
  const targets = await db.select().from(adminAuditLogTargets);
  return logs.map((log) => ({
    id: log.id,
    action: log.action,
    reason: log.reason,
    detail: log.detail,
    occurredAt: log.occurredAt,
    targets: targets
      .filter(({ logId }) => logId === log.id)
      .map(({ targetKind, targetId }) => ({ targetKind, targetId })),
  }));
}

export async function clearReportCaseWrites(): Promise<void> {
  await db.delete(adminAuditLogTargets);
  await db.delete(adminAuditLogs);
  await db.delete(moderationActions);
  await db.delete(reports);
  await db.delete(reportCases);
  await db.delete(users).where(like(users.id, `${REPORTER_ID_PREFIX}%`));
}
