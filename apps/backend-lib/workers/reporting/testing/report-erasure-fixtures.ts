import { env } from 'cloudflare:workers';
import { asc, like } from 'drizzle-orm';

import { createDatabase } from '../../../../db/client.ts';
import { users } from '../../../../db/schema/identity/users.ts';
import { reportCases } from '../../../../db/schema/reporting/report-cases.ts';
import { reports } from '../../../../db/schema/reporting/reports.ts';
import {
  REPORT_CATEGORY_OTHER_ID,
  REPORT_CATEGORY_OTHER_NAME,
} from '../../../../common-lib/reporting/report-rules.ts';

export const db = createDatabase(env.DB);

export const T0 = new Date('2026-11-22T04:21:00.000Z');

const DAY_MS = 24 * 60 * 60 * 1000;

const REPORTER_ID_PREFIX = '01JE0RPTR';

type CaseRow = typeof reportCases.$inferInsert;
type ReportRow = typeof reports.$inferInsert;

export function daysBefore(days: number, from: Date = T0): Date {
  return new Date(from.getTime() - days * DAY_MS);
}

export function reporterIdOf(index: number): string {
  return `${REPORTER_ID_PREFIX}${String(index).padStart(17, '0')}`;
}

export function ownerIdOf(index: number): string {
  return `01JE0OWNR${String(index).padStart(17, '0')}`;
}

export function productIdOf(index: number): string {
  return `01JE0PRDT${String(index).padStart(17, '0')}`;
}

export function commentIdOf(index: number): string {
  return `01JE0CMNT${String(index).padStart(17, '0')}`;
}

export function caseIdOf(index: number): string {
  return `01JE0CASE${String(index).padStart(17, '0')}`;
}

export function reportIdOf(index: number): string {
  return `01JE0REPT${String(index).padStart(17, '0')}`;
}

export async function insertReporters(
  indexes: readonly number[],
): Promise<void> {
  for (const index of indexes) {
    await db.insert(users).values({
      id: reporterIdOf(index),
      pseudonymousId: `reporting-pseudonymous-${String(index)}`,
      email: `reporter${String(index)}@mail.example`,
      passwordHash: 'pbkdf2-sha256$test',
      nickname: `申出者${String(index)}`,
      handle: `reporter${String(index)}`,
      termsAgreedAt: T0,
      createdAt: T0,
      updatedAt: T0,
    });
  }
}

export function openProductCaseOf(
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

export function closedColumnsAt(closedAt: Date): Partial<CaseRow> {
  return {
    status: 'rejected',
    statusChangedAt: closedAt,
    closedAt,
    resolution: null,
    closingReason: '規約に違反しないため',
  };
}

export function detachedColumnsAt(detachedAt: Date): Partial<CaseRow> {
  return {
    targetId: null,
    targetOwnerUserId: null,
    productId: null,
    targetDetachedAt: detachedAt,
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

export async function clearReportingState(): Promise<void> {
  await db.delete(reports);
  await db.delete(reportCases);
  await db.delete(users).where(like(users.id, `${REPORTER_ID_PREFIX}%`));
}

export async function readCases() {
  return db.select().from(reportCases).orderBy(asc(reportCases.id));
}

export async function readReports() {
  return db.select().from(reports).orderBy(asc(reports.id));
}

export async function readCaseIds(): Promise<string[]> {
  return (await readCases()).map((row) => row.id);
}

export async function readReportIds(): Promise<string[]> {
  return (await readReports()).map((row) => row.id);
}
