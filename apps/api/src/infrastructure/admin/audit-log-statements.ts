import { getColumns, type SQL, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { monotonicFactory } from 'ulid';

import {
  type AdminRole,
  hasRole,
} from '../../../common-lib/admin/admin-roles.ts';
import type { Database } from '../../../db/client.ts';
import { adminAuditLogTargets } from '../../../db/schema/admin/admin-audit-log-targets.ts';
import { adminAuditLogs } from '../../../db/schema/admin/admin-audit-logs.ts';
import { admins } from '../../../db/schema/admin/admins.ts';
import type { PreparedAuditEntry } from '../../application/admin/audit-log-recorder.ts';
import {
  type AdminSnapshot,
  checkRoleChangeable,
} from '../../domain/admin/admin-account.ts';

export type AuditGuard =
  | {
      readonly kind: 'delete';
      readonly operator: AdminSnapshot;
      readonly targetId: string;
    }
  | {
      readonly kind: 'role-change';
      readonly operator: AdminSnapshot;
      readonly targetId: string;
      readonly role: AdminRole;
    };

export type AuditLogStatements = readonly [
  BatchItem<'sqlite'>,
  ...BatchItem<'sqlite'>[],
];

const MAX_BOUND_PARAMETERS = 100;

const TARGET_ROWS_PER_STATEMENT = Math.floor(
  MAX_BOUND_PARAMETERS / Object.keys(getColumns(adminAuditLogTargets)).length,
);

// 条件を満たさない記録の挿入だけが起こす違反。D1は`D1_ERROR: NOT NULL constraint failed: admin_audit_logs.operator_admin_id: SQLITE_CONSTRAINT (...)`を投げ、causeにSQLiteのエラーを持つ
const GUARD_REJECTION_PATTERN =
  /NOT NULL constraint failed: admin_audit_logs\.operator_admin_id(?::|$)/u;

export function isAuditGuardRejection(error: unknown): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    if (GUARD_REJECTION_PATTERN.test(current.message)) {
      return true;
    }
  }
  return false;
}

const NEVER = sql`0`;

const exists = (condition: SQL): SQL =>
  sql`EXISTS (SELECT 1 FROM ${admins} WHERE ${condition})`;

// 要求ごとに読み取った操作者の状態が書き込みの時点でも保存済みの値のままであること
const operatorStillHolds = (operator: AdminSnapshot): SQL =>
  exists(
    sql`${admins.id} = ${operator.id} AND ${admins.role} = ${operator.role} AND ${admins.status} = 'active'`,
  );

const isActiveSuperAdmin = (adminId: string): SQL =>
  exists(
    sql`${admins.id} = ${adminId} AND ${admins.role} = 'super_admin' AND ${admins.status} = 'active'`,
  );

// 対象が有効な最上位管理者なら、対象の他にも有効な最上位管理者がいること
const keepsActiveSuperAdmin = (targetId: string): SQL =>
  sql`(NOT ${isActiveSuperAdmin(targetId)} OR ${exists(
    sql`${admins.id} <> ${targetId} AND ${admins.role} = 'super_admin' AND ${admins.status} = 'active'`,
  )})`;

function deleteCondition(operator: AdminSnapshot, targetId: string): SQL {
  if (operator.id === targetId || !hasRole(operator.role, 'moderator')) {
    return NEVER;
  }
  const targetAllowed =
    operator.role === 'super_admin'
      ? exists(sql`${admins.id} = ${targetId}`)
      : exists(
          sql`${admins.id} = ${targetId} AND ${admins.role} <> 'super_admin'`,
        );
  return sql`(${operatorStillHolds(operator)} AND ${targetAllowed} AND ${keepsActiveSuperAdmin(targetId)})`;
}

function roleChangeCondition(
  operator: AdminSnapshot,
  targetId: string,
  role: AdminRole,
): SQL {
  if (checkRoleChangeable(operator) !== undefined) {
    return NEVER;
  }
  const targetExists = exists(sql`${admins.id} = ${targetId}`);
  if (role === 'super_admin') {
    return sql`(${operatorStillHolds(operator)} AND ${targetExists})`;
  }
  return sql`(${operatorStillHolds(operator)} AND ${targetExists} AND ${keepsActiveSuperAdmin(targetId)})`;
}

function guardCondition(guard: AuditGuard): SQL {
  return guard.kind === 'delete'
    ? deleteCondition(guard.operator, guard.targetId)
    : roleChangeCondition(guard.operator, guard.targetId, guard.role);
}

// 条件を満たさないと操作者のIDがNULLになり、NOT NULL制約の違反で同じ一括の書き込みの全体が取り消される
function operatorAdminIdOf(
  entry: PreparedAuditEntry,
  guard: AuditGuard | undefined,
): string | SQL {
  if (guard === undefined) {
    return entry.operatorAdminId;
  }
  return sql`CASE WHEN ${guardCondition(guard)} THEN ${entry.operatorAdminId} ELSE NULL END`;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

function targetInserts(
  db: Database,
  entry: PreparedAuditEntry,
): BatchItem<'sqlite'>[] {
  const { targetKind } = entry;
  if (targetKind === null) {
    return [];
  }
  // 照会で記録の順に並べられるよう、対象の行のIDを単調増加で採番する
  const nextId = monotonicFactory();
  const rows = entry.targetIds.map((targetId) => ({
    id: nextId(entry.occurredAt.getTime()),
    logId: entry.id,
    targetKind,
    targetId,
    createdAt: entry.occurredAt,
    updatedAt: entry.occurredAt,
  }));
  return chunk(rows, TARGET_ROWS_PER_STATEMENT).map((part) =>
    db.insert(adminAuditLogTargets).values(part),
  );
}

// 管理操作の文と同じdb.batch()に含めるための、監査ログと対象の挿入。guardを渡すと、条件を満たさないとき一括の書き込み全体を取り消す
export function buildAuditLogStatements(
  db: Database,
  entry: PreparedAuditEntry,
  guard?: AuditGuard,
): AuditLogStatements {
  return [
    db.insert(adminAuditLogs).values({
      id: entry.id,
      operatorAdminId: operatorAdminIdOf(entry, guard),
      action: entry.action,
      targetKind: entry.targetKind,
      reason: entry.reason,
      detail: entry.detail,
      occurredAt: entry.occurredAt,
      createdAt: entry.occurredAt,
      updatedAt: entry.occurredAt,
    }),
    ...targetInserts(db, entry),
  ];
}
