import { env } from 'cloudflare:workers';
import { asc, like } from 'drizzle-orm';

import { createDatabase } from '../../../../db/client.ts';
import { dataExports } from '../../../../db/schema/data-export/data-exports.ts';
import { users } from '../../../../db/schema/identity/users.ts';

export const db = createDatabase(env.DB);

export const T0 = new Date('2026-11-22T04:21:00.000Z');

const MINUTE_MS = 60 * 1000;

const DAY_MS = 24 * 60 * MINUTE_MS;

const USER_ID_PREFIX = '01JE0DXUS';

const EXPORT_ID_PREFIX = '01JE0DXPT';

const INSERT_CHUNK_SIZE = 50;

export type ExportRow = typeof dataExports.$inferInsert;

export function userIdOf(index: number): string {
  return `${USER_ID_PREFIX}${String(index).padStart(17, '0')}`;
}

export function exportIdOf(index: number): string {
  return `${EXPORT_ID_PREFIX}${String(index).padStart(17, '0')}`;
}

export function minutesAfter(minutes: number, from: Date = T0): Date {
  return new Date(from.getTime() + minutes * MINUTE_MS);
}

export function daysAfter(days: number, from: Date = T0): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

export async function insertUsers(indexes: readonly number[]): Promise<void> {
  for (const index of indexes) {
    await db.insert(users).values({
      id: userIdOf(index),
      pseudonymousId: `data-export-pseudonymous-${String(index)}`,
      email: `exporter${String(index)}@mail.example`,
      passwordHash: 'pbkdf2-sha256$test',
      nickname: `利用者${String(index)}`,
      handle: `exporter${String(index)}`,
      termsAgreedAt: T0,
      createdAt: T0,
      updatedAt: T0,
    });
  }
}

export function queuedRowOf(
  index: number,
  userIndex: number,
  columns: Partial<ExportRow> = {},
): ExportRow {
  const requestedAt = minutesAfter(index);
  return {
    id: exportIdOf(index),
    userId: userIdOf(userIndex),
    status: 'queued',
    requestedAt,
    createdAt: requestedAt,
    updatedAt: requestedAt,
    ...columns,
  };
}

export function readyColumnsOf(expiresAt: Date): Partial<ExportRow> {
  return {
    status: 'ready',
    objectKey: 'data-exports/ready.zip',
    fileName: 'launch-stadium-export.zip',
    byteSize: 1024,
    completedAt: T0,
    expiresAt,
    noticeStatus: 'pending',
  };
}

export function expiredColumnsOf(): Partial<ExportRow> {
  return {
    status: 'expired',
    fileName: 'launch-stadium-export.zip',
    byteSize: 1024,
    completedAt: T0,
    expiresAt: daysAfter(7),
    noticeStatus: 'requested',
  };
}

export function failedColumnsOf(): Partial<ExportRow> {
  return {
    status: 'failed',
    failedAt: T0,
    failureKind: 'error',
    noticeStatus: 'requested',
  };
}

export async function seed(rows: readonly ExportRow[]): Promise<void> {
  for (let start = 0; start < rows.length; start += INSERT_CHUNK_SIZE) {
    const [first, ...rest] = rows
      .slice(start, start + INSERT_CHUNK_SIZE)
      .map((row) => db.insert(dataExports).values(row));
    if (first !== undefined) {
      await db.batch([first, ...rest]);
    }
  }
}

export async function clearDataExportState(): Promise<void> {
  await db.delete(dataExports);
  await db.delete(users).where(like(users.id, `${USER_ID_PREFIX}%`));
}

export async function readExportIds(): Promise<string[]> {
  const rows = await db
    .select({ id: dataExports.id })
    .from(dataExports)
    .orderBy(asc(dataExports.id));
  return rows.map((row) => row.id);
}

export async function readTableSql(): Promise<string> {
  const row = await env.DB.prepare(
    "select sql from sqlite_master where type = 'table' and name = 'data_exports'",
  ).first<{ sql: string }>();
  if (row === null) {
    throw new Error('data_exportsテーブルが無い');
  }
  return row.sql;
}
