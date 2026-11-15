import { resetSync } from '@logtape/logtape';
import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { isNotNull } from 'drizzle-orm';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';

import {
  ADMIN_ACCOUNT_INVITE_ACTION,
  USER_EMAIL_SEARCH_ACTION,
} from '../../common-lib/admin/audit-actions/admin-foundation.ts';
import { adminAuditLogTargets } from '../../db/schema/admin/admin-audit-log-targets.ts';
import { adminAuditLogs } from '../../db/schema/admin/admin-audit-logs.ts';
import { adminAuthTokens } from '../../db/schema/admin/admin-auth-tokens.ts';
import { adminLoginChallenges } from '../../db/schema/admin/admin-login-challenges.ts';
import { adminSessions } from '../../db/schema/admin/admin-sessions.ts';
import { adminTotpCredentials } from '../../db/schema/admin/admin-totp-credentials.ts';
import { createCronRegistry } from '../../lib/core/scheduling/cron-registry.ts';
import { ADMIN_TYPES } from '../application/admin/admin-types.ts';
import { ADMIN_CREDENTIAL_CLEANUP_LIMIT } from '../application/admin/jobs/admin-credential-cleanup-job.ts';
import {
  AUDIT_LOG_DELETE_BATCH_SIZE,
  AUDIT_LOG_DELETE_MAX_BATCHES,
  auditLogRetentionCutoff,
} from '../application/admin/jobs/audit-log-retention-job.ts';
import {
  adminIdOf,
  auditLogIdOf,
  clearAdminTables,
  createAuditLogRecorder,
  createSequentialAuditLogIds,
  db,
  insertAdmin,
  pseudonymousIdOf,
  readAuditLogSummaries,
  readAuditLogTargetIds,
} from '../infrastructure/admin/testing/admin-store-fixtures.ts';
import * as mainModule from '../index.ts';
import { SCHEDULED_JOBS } from './scheduled-jobs.ts';

interface LoggedObject {
  readonly level: string;
  readonly category: string;
  readonly message: string;
  readonly [property: string]: unknown;
}

const DAY_MS = 86_400_000;

// 業務日付2026-11-02の業務時刻4:21
const SCHEDULED_TIME = new Date(Date.UTC(2026, 10, 2, 12, 21));
const NEXT_DAY = new Date(SCHEDULED_TIME.getTime() + DAY_MS);
const DAILY_CRON = '21 12 * * *';
const CUTOFF = auditLogRetentionCutoff(SCHEDULED_TIME);

const CLEANUP_JOB = 'admin-foundation.credential-cleanup';
const RETENTION_JOB = 'admin-foundation.audit-log-retention';
const CLEANUP_CATEGORY = 'api.admin.credential-cleanup';
const RETENTION_CATEGORY = 'api.admin.audit-log-retention';

const OWNER = 1;

function recordConsole(): LoggedObject[] {
  const logs: LoggedObject[] = [];
  const record = (...args: unknown[]) => {
    logs.push(args[0] as LoggedObject);
  };
  for (const method of ['debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation(record);
  }
  return logs;
}

async function runScheduled(scheduledTime: Date): Promise<void> {
  const scheduled = mainModule.default.scheduled;
  if (scheduled === undefined) {
    throw new Error('定期実行のハンドラーがエクスポートされていません');
  }
  const ctx = createExecutionContext();
  await scheduled(
    createScheduledController({
      cron: DAILY_CRON,
      scheduledTime: scheduledTime.getTime(),
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
}

// 上限を超える件数の行を1文ずつで用意するため、連番を再帰の共通テーブル式で作って挿入する。期限はちょうど期限切れになる境界の値にする
async function insertExpiredCredentials(count: number): Promise<void> {
  const owner = adminIdOf(OWNER);
  const at = SCHEDULED_TIME.getTime();
  const idleBoundary = at - 60 * 60 * 1000;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO admins (id, email, role, status, created_at, updated_at)
       WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ?1)
       SELECT printf('01JC0BULKADMN%013d', n), printf('bulk%d@mail.example', n), 'viewer', 'active', ?2, ?2 FROM seq`,
    ).bind(count, idleBoundary),
    env.DB.prepare(
      `INSERT INTO admin_sessions (id, admin_id, token_hash, last_used_at, absolute_expires_at, created_at, updated_at)
       WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ?1)
       SELECT printf('01JC0BULKSESN%013d', n), ?2, printf('bulk-session-%d', n), ?3, ?4, ?3, ?3 FROM seq`,
    ).bind(count, owner, idleBoundary, at + DAY_MS / 2),
    env.DB.prepare(
      `INSERT INTO admin_auth_tokens (id, admin_id, purpose, token_hash, expires_at, created_at, updated_at)
       WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ?1)
       SELECT printf('01JC0BULKTOKN%013d', n), ?2, 'password_reset', printf('bulk-link-%d', n), ?3, ?4, ?4 FROM seq`,
    ).bind(count, owner, at, idleBoundary),
    env.DB.prepare(
      `INSERT INTO admin_login_challenges (id, admin_id, token_hash, expires_at, created_at, updated_at)
       WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ?1)
       SELECT printf('01JC0BULKCHLG%013d', n), ?2, printf('bulk-challenge-%d', n), ?3, ?4, ?4 FROM seq`,
    ).bind(count, owner, at, idleBoundary),
    env.DB.prepare(
      `INSERT INTO admin_totp_credentials (id, admin_id, pending_sealed_secret, pending_expires_at, created_at, updated_at)
       WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ?1)
       SELECT printf('01JC0BULKTOTP%013d', n), printf('01JC0BULKADMN%013d', n), 'sealed-pending', ?2, ?3, ?3 FROM seq`,
    ).bind(count, at, idleBoundary),
  ]);
}

// 翌日の起動でも期限内のまま残る行を、各テーブルに1件ずつ置く
async function insertValidCredentials(): Promise<void> {
  const owner = adminIdOf(OWNER);
  const later = new Date(NEXT_DAY.getTime() + 60 * 60 * 1000);
  await db.insert(adminSessions).values({
    adminId: owner,
    tokenHash: 'valid-session',
    lastUsedAt: NEXT_DAY,
    absoluteExpiresAt: later,
    createdAt: SCHEDULED_TIME,
    updatedAt: SCHEDULED_TIME,
  });
  await db.insert(adminAuthTokens).values({
    adminId: owner,
    purpose: 'password_reset',
    tokenHash: 'valid-link',
    expiresAt: later,
    createdAt: SCHEDULED_TIME,
    updatedAt: SCHEDULED_TIME,
  });
  await db.insert(adminLoginChallenges).values({
    adminId: owner,
    tokenHash: 'valid-challenge',
    expiresAt: later,
    createdAt: SCHEDULED_TIME,
    updatedAt: SCHEDULED_TIME,
  });
  await db.insert(adminTotpCredentials).values({
    adminId: owner,
    pendingSealedSecret: 'sealed-valid-pending',
    pendingExpiresAt: later,
    createdAt: SCHEDULED_TIME,
    updatedAt: SCHEDULED_TIME,
  });
}

async function countCredentials() {
  const [sessions, mailLinks, loginChallenges, totpPendings] =
    await Promise.all([
      db.$count(adminSessions),
      db.$count(adminAuthTokens),
      db.$count(adminLoginChallenges),
      db.$count(
        adminTotpCredentials,
        isNotNull(adminTotpCredentials.pendingSealedSecret),
      ),
    ]);
  return { sessions, mailLinks, loginChallenges, totpPendings };
}

async function insertOldAuditLogs(count: number, occurredAt: Date) {
  const at = occurredAt.getTime();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO admin_audit_logs (id, operator_admin_id, action, target_kind, detail, occurred_at, created_at, updated_at)
       WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ?1)
       SELECT printf('01JC0BULKALOG%013d', n), ?2, ?3, 'admin', '{}', ?4, ?4, ?4 FROM seq`,
    ).bind(count, adminIdOf(OWNER), ADMIN_ACCOUNT_INVITE_ACTION.name, at),
    env.DB.prepare(
      `INSERT INTO admin_audit_log_targets (id, log_id, target_kind, target_id, created_at, updated_at)
       WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ?1)
       SELECT printf('01JC0BULKATGT%013d', n), printf('01JC0BULKALOG%013d', n), 'admin', ?2, ?3, ?3 FROM seq`,
    ).bind(count, adminIdOf(2), at),
  ]);
}

function jobOutcomesOf(logs: readonly LoggedObject[]) {
  const summary = logs.find(
    ({ message }) => message === '定期実行を終えました',
  );
  const jobs = (summary?.['jobs'] ?? []) as readonly {
    readonly name: string;
    readonly result: string;
  }[];
  return jobs
    .filter(({ name }) => name.startsWith('admin-foundation.'))
    .map(({ name, result }) => ({ name, result }));
}

function logsOf(logs: readonly LoggedObject[], category: string) {
  return logs.filter((log) => log.category === category);
}

beforeEach(async () => {
  await clearAdminTables();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  resetSync();
});

describe('管理者の日次のジョブの登録', () => {
  test('2つのジョブを業務時刻4:21に順序200・210で登録する', () => {
    expect(
      SCHEDULED_JOBS.filter(({ name }) => name.startsWith('admin-foundation.')),
    ).toEqual([
      {
        name: CLEANUP_JOB,
        at: { hour: 4, minute: 21 },
        order: 200,
        handler: ADMIN_TYPES.AdminCredentialCleanupJob,
      },
      {
        name: RETENTION_JOB,
        at: { hour: 4, minute: 21 },
        order: 210,
        handler: ADMIN_TYPES.AuditLogRetentionJob,
      },
    ]);
  });

  test('4:21の起動で、利用者のアカウントのジョブの後に期限切れの削除→監査ログの保持期限の削除の順で続けて動く', () => {
    const names = createCronRegistry(SCHEDULED_JOBS)
      .jobsFor(DAILY_CRON)
      .map(({ name }) => name);

    const cleanupIndex = names.indexOf(CLEANUP_JOB);
    expect(cleanupIndex).toBeGreaterThan(
      names.indexOf('identity-auth.disposable-recheck-sweep'),
    );
    expect(names.indexOf(RETENTION_JOB)).toBe(cleanupIndex + 1);
  });
});

describe('定期実行からの期限切れの認証情報の削除', () => {
  test('4:21の起動で、期限切れのセッション・認証系トークン・第2要素の待ち・TOTPの保留をそれぞれ上限件数まで消し、残りは翌日の起動で消す', async () => {
    await insertAdmin(OWNER);
    await insertExpiredCredentials(ADMIN_CREDENTIAL_CLEANUP_LIMIT + 1);
    await insertValidCredentials();
    const logs = recordConsole();

    await runScheduled(SCHEDULED_TIME);

    expect(await countCredentials()).toEqual({
      sessions: 2,
      mailLinks: 2,
      loginChallenges: 2,
      totpPendings: 2,
    });
    expect(logsOf(logs, CLEANUP_CATEGORY)).toEqual([
      expect.objectContaining({
        level: 'info',
        sessions: ADMIN_CREDENTIAL_CLEANUP_LIMIT,
        mailLinks: ADMIN_CREDENTIAL_CLEANUP_LIMIT,
        loginChallenges: ADMIN_CREDENTIAL_CLEANUP_LIMIT,
        totpPendings: ADMIN_CREDENTIAL_CLEANUP_LIMIT,
        failed: 0,
      }),
    ]);
    expect(jobOutcomesOf(logs)).toEqual([
      { name: CLEANUP_JOB, result: 'succeeded' },
      { name: RETENTION_JOB, result: 'succeeded' },
    ]);

    await runScheduled(NEXT_DAY);

    expect(await countCredentials()).toEqual({
      sessions: 1,
      mailLinks: 1,
      loginChallenges: 1,
      totpPendings: 1,
    });
    expect(await db.$count(adminTotpCredentials)).toBe(
      ADMIN_CREDENTIAL_CLEANUP_LIMIT + 2,
    );
  });
});

describe('定期実行からの監査ログの保持期限の削除', () => {
  test('4:21の起動で、記録から3年以上経過した監査ログを対象の行とともに消し、3年未満は残す', async () => {
    const recorder = createAuditLogRecorder({
      ids: createSequentialAuditLogIds(1),
    });
    await recorder.record({
      operatorAdminId: adminIdOf(OWNER),
      action: USER_EMAIL_SEARCH_ACTION.name,
      targetIds: [pseudonymousIdOf(1), pseudonymousIdOf(2)],
      occurredAt: new Date(CUTOFF.getTime() - 1),
    });
    for (const [index, occurredAt] of [
      [3, CUTOFF],
      [4, new Date(CUTOFF.getTime() + 1)],
    ] as const) {
      await recorder.record({
        operatorAdminId: adminIdOf(OWNER),
        action: ADMIN_ACCOUNT_INVITE_ACTION.name,
        targetIds: [adminIdOf(index)],
        occurredAt,
      });
    }
    const logs = recordConsole();

    await runScheduled(SCHEDULED_TIME);

    expect((await readAuditLogSummaries()).map(({ id }) => id)).toEqual([
      auditLogIdOf(3),
    ]);
    expect(await readAuditLogTargetIds()).toEqual([adminIdOf(4)]);
    expect(logsOf(logs, RETENTION_CATEGORY)).toEqual([
      expect.objectContaining({
        level: 'info',
        deleted: 2,
        batches: 1,
        limitReached: false,
      }),
    ]);
  });

  test('1回の起動で消す件数の上限を超える分は残し、翌日の起動で続きを消す', async () => {
    const perRun = AUDIT_LOG_DELETE_BATCH_SIZE * AUDIT_LOG_DELETE_MAX_BATCHES;
    await insertOldAuditLogs(perRun + 1, new Date(CUTOFF.getTime() - DAY_MS));
    const logs = recordConsole();

    await runScheduled(SCHEDULED_TIME);

    expect(await db.$count(adminAuditLogs)).toBe(1);
    expect(await db.$count(adminAuditLogTargets)).toBe(1);
    expect(logsOf(logs, RETENTION_CATEGORY)).toEqual([
      expect.objectContaining({
        level: 'info',
        deleted: perRun,
        batches: AUDIT_LOG_DELETE_MAX_BATCHES,
        limitReached: true,
      }),
    ]);

    await runScheduled(NEXT_DAY);

    expect(await db.$count(adminAuditLogs)).toBe(0);
    expect(await db.$count(adminAuditLogTargets)).toBe(0);
  });
});
