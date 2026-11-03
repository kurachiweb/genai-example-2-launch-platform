import { env } from 'cloudflare:workers';

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
import { D1AuditLogStore } from '../d1-audit-log-store.ts';

export const T0 = new Date('2026-11-01T00:00:00.000Z');

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
