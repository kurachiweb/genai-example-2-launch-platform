import { env } from 'cloudflare:workers';
import { asc, eq } from 'drizzle-orm';

import {
  type AuditActionCatalog,
  createAuditActionCatalog,
} from '../../../../common-lib/admin/audit-action.ts';
import { AUDIT_ACTIONS } from '../../../../common-lib/admin/audit-actions/index.ts';
import { createDatabase, type Database } from '../../../../db/client.ts';
import { adminAuditLogTargets } from '../../../../db/schema/admin/admin-audit-log-targets.ts';
import { adminAuditLogs } from '../../../../db/schema/admin/admin-audit-logs.ts';
import { adminAuthTokens } from '../../../../db/schema/admin/admin-auth-tokens.ts';
import { adminLoginChallenges } from '../../../../db/schema/admin/admin-login-challenges.ts';
import { adminRecoveryCodes } from '../../../../db/schema/admin/admin-recovery-codes.ts';
import { adminSessions } from '../../../../db/schema/admin/admin-sessions.ts';
import { adminTotpCredentials } from '../../../../db/schema/admin/admin-totp-credentials.ts';
import { admins } from '../../../../db/schema/admin/admins.ts';
import type { IdGenerator } from '../../../../lib/core/ids/id-generator.ts';
import {
  type AuditLogRecorder,
  StoreAuditLogRecorder,
} from '../../../application/admin/audit-log-recorder.ts';
import type { AuditLogStore } from '../../../application/admin/ports.ts';
import type { AdminSnapshot } from '../../../domain/admin/admin-account.ts';
import type { AdminAuthTokenPurpose } from '../../../domain/admin/admin-auth-token-purpose.ts';
import { D1AuditLogStore } from '../d1-audit-log-store.ts';

export const T0 = new Date('2026-11-01T00:00:00.000Z');

export const HOUR_MS = 60 * 60 * 1000;

export const db = createDatabase(env.DB);

type AdminRow = typeof admins.$inferInsert;

export function after(milliseconds: number): Date {
  return new Date(T0.getTime() + milliseconds);
}

export function adminIdOf(index: number): string {
  return `01JC0ADMN${String(index).padStart(17, '0')}`;
}

export function adminEmailOf(index: number): string {
  return `admin${String(index)}@mail.example`;
}

export function auditLogIdOf(index: number): string {
  return `01JC0ALOG${String(index).padStart(17, '0')}`;
}

// 利用者の対象は仮名化ID(UUID)だけを受け付けるため、番号から妥当なUUIDを作る
export function pseudonymousIdOf(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

export async function insertAdmin(
  index: number,
  columns: Partial<AdminRow> = {},
): Promise<void> {
  await db.insert(admins).values({
    id: adminIdOf(index),
    email: adminEmailOf(index),
    passwordHash: 'pbkdf2-sha256$test',
    nickname: `管理者${String(index)}`,
    role: 'viewer',
    status: 'active',
    activatedAt: T0,
    createdAt: T0,
    updatedAt: T0,
    ...columns,
  });
}

export async function insertInvitedAdmin(
  index: number,
  columns: Partial<AdminRow> = {},
): Promise<void> {
  await insertAdmin(index, {
    status: 'invited',
    passwordHash: null,
    nickname: null,
    activatedAt: null,
    invitationExpiresAt: after(24 * HOUR_MS),
    ...columns,
  });
}

export function adminSnapshotOf(
  index: number,
  role: AdminSnapshot['role'],
): AdminSnapshot {
  return {
    id: adminIdOf(index),
    role,
    status: 'active',
    invitationExpiresAt: null,
  };
}

export async function insertAdminToken(
  adminIndex: number,
  purpose: AdminAuthTokenPurpose,
  tokenHash: string,
): Promise<void> {
  await db.insert(adminAuthTokens).values({
    adminId: adminIdOf(adminIndex),
    purpose,
    tokenHash,
    expiresAt: after(HOUR_MS),
    createdAt: T0,
    updatedAt: T0,
  });
}

export async function insertAdminSession(
  adminIndex: number,
  tokenHash: string,
): Promise<void> {
  await db.insert(adminSessions).values({
    adminId: adminIdOf(adminIndex),
    tokenHash,
    lastUsedAt: T0,
    absoluteExpiresAt: after(12 * HOUR_MS),
    createdAt: T0,
    updatedAt: T0,
  });
}

// 削除で消えることを確かめるため、管理者を参照する5つのテーブルにそれぞれ1行を置く
export async function insertAdminChildRows(adminIndex: number): Promise<void> {
  const prefix = `admin-${String(adminIndex)}`;
  await insertAdminSession(adminIndex, `${prefix}-session`);
  await insertAdminToken(adminIndex, 'password_reset', `${prefix}-token`);
  await db.insert(adminLoginChallenges).values({
    adminId: adminIdOf(adminIndex),
    tokenHash: `${prefix}-challenge`,
    expiresAt: after(5 * 60_000),
    createdAt: T0,
    updatedAt: T0,
  });
  await db.insert(adminTotpCredentials).values({
    adminId: adminIdOf(adminIndex),
    sealedSecret: `${prefix}-secret`,
    enabledAt: T0,
    createdAt: T0,
    updatedAt: T0,
  });
  await db.insert(adminRecoveryCodes).values({
    adminId: adminIdOf(adminIndex),
    codeHash: `${prefix}-recovery`,
    createdAt: T0,
    updatedAt: T0,
  });
}

export interface AdminChildRowCounts {
  readonly sessions: number;
  readonly tokens: number;
  readonly challenges: number;
  readonly totp: number;
  readonly recovery: number;
}

export async function countAdminChildRows(
  adminIndex: number,
): Promise<AdminChildRowCounts> {
  const adminId = adminIdOf(adminIndex);
  const [sessions, tokens, challenges, totp, recovery] = await Promise.all([
    db.$count(adminSessions, eq(adminSessions.adminId, adminId)),
    db.$count(adminAuthTokens, eq(adminAuthTokens.adminId, adminId)),
    db.$count(adminLoginChallenges, eq(adminLoginChallenges.adminId, adminId)),
    db.$count(adminTotpCredentials, eq(adminTotpCredentials.adminId, adminId)),
    db.$count(adminRecoveryCodes, eq(adminRecoveryCodes.adminId, adminId)),
  ]);
  return { sessions, tokens, challenges, totp, recovery };
}

export async function readAdminRow(
  index: number,
): Promise<typeof admins.$inferSelect | undefined> {
  const [row] = await db
    .select()
    .from(admins)
    .where(eq(admins.id, adminIdOf(index)));
  return row;
}

export async function readAuditLogSummaries() {
  return db
    .select({
      id: adminAuditLogs.id,
      operatorAdminId: adminAuditLogs.operatorAdminId,
      action: adminAuditLogs.action,
      detail: adminAuditLogs.detail,
    })
    .from(adminAuditLogs)
    .orderBy(asc(adminAuditLogs.id));
}

export async function readAuditLogTargetIds(): Promise<string[]> {
  const rows = await db
    .select({ targetId: adminAuditLogTargets.targetId })
    .from(adminAuditLogTargets)
    .orderBy(asc(adminAuditLogTargets.id));
  return rows.map((row) => row.targetId);
}

export async function clearAdminTables(): Promise<void> {
  await db.delete(adminAuditLogTargets);
  await db.delete(adminAuditLogs);
  await db.delete(adminRecoveryCodes);
  await db.delete(adminTotpCredentials);
  await db.delete(adminLoginChallenges);
  await db.delete(adminAuthTokens);
  await db.delete(adminSessions);
  await db.delete(admins);
}

// 検証で作った監査ログの識別子を予測できるよう、指定した番号から順に識別子を作る
export function createSequentialAuditLogIds(start = 1): IdGenerator {
  let next = start;
  return {
    generate: () => {
      const id = auditLogIdOf(next);
      next += 1;
      return id;
    },
  };
}

export const AUDIT_ACTION_CATALOG: AuditActionCatalog =
  createAuditActionCatalog(AUDIT_ACTIONS);

// 準備の値は記録の部品だけが作れるため、本物の記録の部品に予測できる識別子とテスト用のD1を渡す
export function createAuditLogRecorder(
  options: {
    readonly database?: Database;
    readonly ids?: IdGenerator;
    readonly catalog?: AuditActionCatalog;
    readonly store?: AuditLogStore;
  } = {},
): AuditLogRecorder {
  return new StoreAuditLogRecorder(
    options.catalog ?? AUDIT_ACTION_CATALOG,
    options.ids ?? createSequentialAuditLogIds(),
    options.store ?? new D1AuditLogStore(options.database ?? db),
  );
}
