import { env } from 'cloudflare:workers';
import { asc, eq, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { beforeEach, describe, expect, test } from 'vitest';

import type { AdminRole } from '../../../common-lib/admin/admin-roles.ts';
import {
  ADMIN_ACCOUNT_DELETE_ACTION,
  ADMIN_ACCOUNT_INVITE_ACTION,
  ADMIN_ACCOUNT_ROLE_CHANGE_ACTION,
  USER_EMAIL_SEARCH_ACTION,
} from '../../../common-lib/admin/audit-actions/admin-foundation.ts';
import { createDatabase } from '../../../db/client.ts';
import { adminAuditLogTargets } from '../../../db/schema/admin/admin-audit-log-targets.ts';
import { adminAuditLogs } from '../../../db/schema/admin/admin-audit-logs.ts';
import { admins } from '../../../db/schema/admin/admins.ts';
import type { PreparedAuditEntry } from '../../../lib/core/admin/audit-log.ts';
import { createBatchRecordingD1 } from '../../../test/support/batch-recording-d1.ts';
import type { AdminSnapshot } from '../../domain/admin/admin-account.ts';
import {
  type AuditGuard,
  buildAuditLogStatements,
  isAuditGuardRejection,
} from './audit-log-statements.ts';
import {
  adminEmailOf,
  adminIdOf,
  after,
  auditLogIdOf,
  clearAdminTables,
  createAuditLogRecorder,
  db,
  insertAdmin,
  pseudonymousIdOf,
} from './testing/admin-store-fixtures.ts';

const MAX_BOUND_PARAMETERS = 100;

const AT = after(60_000);

const OPERATOR = 1;

const TARGET = 2;

const OTHER = 3;

const NEW_ADMIN = 9;

type Batch = readonly [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]];

function snapshotOf(
  index: number,
  role: AdminRole,
  status: AdminSnapshot['status'] = 'active',
): AdminSnapshot {
  return {
    id: adminIdOf(index),
    role,
    status,
    invitationExpiresAt: null,
  };
}

function prepareInvite(targetIndex = NEW_ADMIN): PreparedAuditEntry {
  return createAuditLogRecorder().prepare({
    operatorAdminId: adminIdOf(OPERATOR),
    action: ADMIN_ACCOUNT_INVITE_ACTION.name,
    targetIds: [adminIdOf(targetIndex)],
    occurredAt: AT,
  });
}

function prepareDelete(operatorIndex: number, targetIndex: number) {
  return createAuditLogRecorder().prepare({
    operatorAdminId: adminIdOf(operatorIndex),
    action: ADMIN_ACCOUNT_DELETE_ACTION.name,
    targetIds: [adminIdOf(targetIndex)],
    reason: '退職のため',
    occurredAt: AT,
  });
}

function prepareRoleChange(
  operatorIndex: number,
  targetIndex: number,
  roles: { readonly from: AdminRole; readonly to: AdminRole },
  logIndex = 1,
) {
  return createAuditLogRecorder({
    ids: { generate: () => auditLogIdOf(logIndex) },
  }).prepare({
    operatorAdminId: adminIdOf(operatorIndex),
    action: ADMIN_ACCOUNT_ROLE_CHANGE_ACTION.name,
    targetIds: [adminIdOf(targetIndex)],
    detail: { fromRole: roles.from, toRole: roles.to },
    occurredAt: AT,
  });
}

function insertNewAdmin(index: number, email = adminEmailOf(index)) {
  return db.insert(admins).values({
    id: adminIdOf(index),
    email,
    role: 'viewer',
    invitationExpiresAt: after(3_600_000),
    createdAt: AT,
    updatedAt: AT,
  });
}

function deleteAdmin(index: number) {
  return db.delete(admins).where(eq(admins.id, adminIdOf(index)));
}

function changeRole(index: number, role: AdminRole) {
  return db
    .update(admins)
    .set({ role, updatedAt: AT })
    .where(eq(admins.id, adminIdOf(index)));
}

async function commit(
  entry: PreparedAuditEntry,
  guard: AuditGuard | undefined,
  ...operations: BatchItem<'sqlite'>[]
): Promise<'committed' | 'rejected'> {
  const batch: Batch = [
    ...buildAuditLogStatements(db, entry, guard),
    ...operations,
  ];
  try {
    await db.batch(batch);
    return 'committed';
  } catch (error) {
    if (isAuditGuardRejection(error)) {
      return 'rejected';
    }
    throw error;
  }
}

async function readLogs() {
  return db.select().from(adminAuditLogs).orderBy(asc(adminAuditLogs.id));
}

async function readTargets() {
  return db
    .select({
      logId: adminAuditLogTargets.logId,
      targetKind: adminAuditLogTargets.targetKind,
      targetId: adminAuditLogTargets.targetId,
    })
    .from(adminAuditLogTargets)
    .orderBy(asc(adminAuditLogTargets.id));
}

async function readAdmin(index: number) {
  const [row] = await db
    .select({ role: admins.role, status: admins.status })
    .from(admins)
    .where(eq(admins.id, adminIdOf(index)));
  return row;
}

beforeEach(async () => {
  await clearAdminTables();
});

describe('buildAuditLogStatements(条件なし)', () => {
  test('他の文と同じ一括の書き込みに含めると、監査ログ・対象・他の文の結果がそろって確定する', async () => {
    await insertAdmin(OPERATOR, { role: 'moderator' });
    const entry = prepareInvite();

    await expect(
      commit(entry, undefined, insertNewAdmin(NEW_ADMIN)),
    ).resolves.toBe('committed');

    expect(await readLogs()).toEqual([
      {
        id: entry.id,
        operatorAdminId: adminIdOf(OPERATOR),
        action: ADMIN_ACCOUNT_INVITE_ACTION.name,
        targetKind: 'admin',
        reason: null,
        detail: {},
        occurredAt: AT,
        createdAt: AT,
        updatedAt: AT,
      },
    ]);
    expect(await readTargets()).toEqual([
      { logId: entry.id, targetKind: 'admin', targetId: adminIdOf(NEW_ADMIN) },
    ]);
    expect(await readAdmin(NEW_ADMIN)).toEqual({
      role: 'viewer',
      status: 'invited',
    });
  });

  test('同じ一括の書き込みの他の文が失敗すると、監査ログも対象も残らない', async () => {
    await insertAdmin(OPERATOR, { role: 'moderator' });
    const duplicated = insertNewAdmin(NEW_ADMIN, adminEmailOf(OPERATOR));

    const failure = commit(prepareInvite(), undefined, duplicated);

    await expect(failure).rejects.toThrow(
      /UNIQUE constraint failed: admins\.email/u,
    );
    expect(await readLogs()).toEqual([]);
    expect(await readTargets()).toEqual([]);
    expect(await readAdmin(NEW_ADMIN)).toBeUndefined();
  });

  test('他の文の失敗は条件付きの記録の取り消しとして扱わない', async () => {
    await insertAdmin(OPERATOR, { role: 'moderator' });
    const duplicated = insertNewAdmin(NEW_ADMIN, adminEmailOf(OPERATOR));

    const error: unknown = await db
      .batch([...buildAuditLogStatements(db, prepareInvite()), duplicated])
      .catch((caught: unknown) => caught);

    expect(isAuditGuardRejection(error)).toBe(false);
  });

  test('対象100件は、各文のバインド変数が上限内に収まる複数の挿入に分かれ、記録の順に保存される', async () => {
    const targetIds = Array.from({ length: 100 }, (_, index) =>
      pseudonymousIdOf(index + 1),
    );
    const entry = createAuditLogRecorder().prepare({
      operatorAdminId: adminIdOf(OPERATOR),
      action: USER_EMAIL_SEARCH_ACTION.name,
      targetIds,
      occurredAt: AT,
    });

    const recording = createBatchRecordingD1(env.DB);
    const recordingDb = createDatabase(recording.d1);
    await recordingDb.batch(buildAuditLogStatements(recordingDb, entry));

    const [queries = []] = recording.batches;
    expect(queries.length).toBeGreaterThan(2);
    for (const query of queries) {
      expect(query.match(/\?/gu)?.length ?? 0).toBeLessThanOrEqual(
        MAX_BOUND_PARAMETERS,
      );
    }
    const stored = await readTargets();
    expect(stored.map((target) => target.targetId)).toEqual(targetIds);
    expect(new Set(stored.map((target) => target.targetKind))).toEqual(
      new Set(['user']),
    );
  });

  test('対象が無い記録は監査ログの行だけを挿入し、対象の種類はNULLになる', async () => {
    const entry = createAuditLogRecorder().prepare({
      operatorAdminId: adminIdOf(OPERATOR),
      action: USER_EMAIL_SEARCH_ACTION.name,
      targetIds: [],
      occurredAt: AT,
    });

    const statements = buildAuditLogStatements(db, entry);
    await db.batch(statements);

    expect(statements).toHaveLength(1);
    expect((await readLogs()).map((log) => log.targetKind)).toEqual([null]);
    expect(await readTargets()).toEqual([]);
  });

  test('監査ログの行には操作者のID以外の個人情報(メールアドレス・ニックネーム)が入らない', async () => {
    await insertAdmin(OPERATOR, { role: 'super_admin' });
    await insertAdmin(TARGET, { role: 'viewer' });
    const roleChange = prepareRoleChange(OPERATOR, TARGET, {
      from: 'viewer',
      to: 'moderator',
    });
    const search = createAuditLogRecorder({
      ids: { generate: () => auditLogIdOf(2) },
    }).prepare({
      operatorAdminId: adminIdOf(OPERATOR),
      action: USER_EMAIL_SEARCH_ACTION.name,
      targetIds: [pseudonymousIdOf(1)],
      occurredAt: AT,
    });

    await commit(roleChange, undefined, changeRole(TARGET, 'moderator'));
    await commit(search, undefined);

    const logs = await env.DB.prepare(
      'SELECT * FROM admin_audit_logs ORDER BY id',
    ).all();
    const targets = await env.DB.prepare(
      'SELECT * FROM admin_audit_log_targets ORDER BY id',
    ).all();
    expect(logs.results.map((row) => Object.keys(row).sort())).toEqual([
      [
        'action',
        'created_at',
        'detail',
        'id',
        'occurred_at',
        'operator_admin_id',
        'reason',
        'target_kind',
        'updated_at',
      ],
      [
        'action',
        'created_at',
        'detail',
        'id',
        'occurred_at',
        'operator_admin_id',
        'reason',
        'target_kind',
        'updated_at',
      ],
    ]);
    expect(logs.results.map((row) => row.operator_admin_id)).toEqual([
      adminIdOf(OPERATOR),
      adminIdOf(OPERATOR),
    ]);
    const stored = JSON.stringify([logs.results, targets.results]);
    for (const personal of [
      adminEmailOf(OPERATOR),
      adminEmailOf(TARGET),
      '管理者1',
      '管理者2',
    ]) {
      expect(stored).not.toContain(personal);
    }
  });
});

describe('buildAuditLogStatements(削除の条件付きの記録)', () => {
  test('条件を満たすと、監査ログと削除がそろって確定する', async () => {
    await insertAdmin(OPERATOR, { role: 'moderator' });
    await insertAdmin(TARGET, { role: 'viewer' });
    const guard: AuditGuard = {
      kind: 'delete',
      operator: snapshotOf(OPERATOR, 'moderator'),
      targetId: adminIdOf(TARGET),
    };

    await expect(
      commit(prepareDelete(OPERATOR, TARGET), guard, deleteAdmin(TARGET)),
    ).resolves.toBe('committed');

    expect(await readAdmin(TARGET)).toBeUndefined();
    expect((await readLogs()).map((log) => log.operatorAdminId)).toEqual([
      adminIdOf(OPERATOR),
    ]);
    expect((await readTargets()).map((target) => target.targetId)).toEqual([
      adminIdOf(TARGET),
    ]);
  });

  test('最上位管理者は、他の有効な最上位管理者と招待中の最上位管理者を削除できる', async () => {
    await insertAdmin(OPERATOR, { role: 'super_admin' });
    await insertAdmin(TARGET, { role: 'super_admin' });
    await insertAdmin(OTHER, {
      role: 'super_admin',
      status: 'invited',
      activatedAt: null,
    });
    const operator = snapshotOf(OPERATOR, 'super_admin');

    const results = [
      await commit(
        prepareDelete(OPERATOR, TARGET),
        { kind: 'delete', operator, targetId: adminIdOf(TARGET) },
        deleteAdmin(TARGET),
      ),
      await commit(
        createAuditLogRecorder({
          ids: { generate: () => auditLogIdOf(2) },
        }).prepare({
          operatorAdminId: adminIdOf(OPERATOR),
          action: ADMIN_ACCOUNT_DELETE_ACTION.name,
          targetIds: [adminIdOf(OTHER)],
          occurredAt: AT,
        }),
        { kind: 'delete', operator, targetId: adminIdOf(OTHER) },
        deleteAdmin(OTHER),
      ),
    ];

    expect(results).toEqual(['committed', 'committed']);
    expect(await readAdmin(OPERATOR)).toEqual({
      role: 'super_admin',
      status: 'active',
    });
  });

  test.each([
    {
      name: '対象が存在しない',
      setup: async () => {
        await insertAdmin(OPERATOR, { role: 'super_admin' });
      },
      operator: snapshotOf(OPERATOR, 'super_admin'),
      target: TARGET,
    },
    {
      name: '自分自身が対象',
      setup: async () => {
        await insertAdmin(OPERATOR, { role: 'super_admin' });
        await insertAdmin(TARGET, { role: 'super_admin' });
      },
      operator: snapshotOf(OPERATOR, 'super_admin'),
      target: OPERATOR,
    },
    {
      name: '閲覧のみの操作者',
      setup: async () => {
        await insertAdmin(OPERATOR, { role: 'viewer' });
        await insertAdmin(TARGET, { role: 'viewer' });
      },
      operator: snapshotOf(OPERATOR, 'viewer'),
      target: TARGET,
    },
    {
      name: 'モデレーターが最上位管理者を対象にした',
      setup: async () => {
        await insertAdmin(OPERATOR, { role: 'moderator' });
        await insertAdmin(TARGET, { role: 'super_admin' });
        await insertAdmin(OTHER, { role: 'super_admin' });
      },
      operator: snapshotOf(OPERATOR, 'moderator'),
      target: TARGET,
    },
    {
      name: '操作者の保存済みのロールが読み取った値から変わった',
      setup: async () => {
        await insertAdmin(OPERATOR, { role: 'viewer' });
        await insertAdmin(TARGET, { role: 'viewer' });
      },
      operator: snapshotOf(OPERATOR, 'moderator'),
      target: TARGET,
    },
    {
      name: '操作者が削除済み',
      setup: async () => {
        await insertAdmin(TARGET, { role: 'viewer' });
      },
      operator: snapshotOf(OPERATOR, 'super_admin'),
      target: TARGET,
    },
  ])(
    '$nameの場合は全体が取り消され、監査ログも削除も残らない',
    async ({ setup, operator, target }) => {
      await setup();
      const before = await readAdmin(target);

      const result = await commit(
        prepareDelete(OPERATOR, target),
        { kind: 'delete', operator, targetId: adminIdOf(target) },
        deleteAdmin(target),
      );

      expect(result).toBe('rejected');
      expect(await readAdmin(target)).toEqual(before);
      expect(await readLogs()).toEqual([]);
      expect(await readTargets()).toEqual([]);
    },
  );
});

describe('buildAuditLogStatements(ロール変更の条件付きの記録)', () => {
  test('最上位管理者は他の管理者のロールを変更でき、最上位管理者へ上げることもできる', async () => {
    await insertAdmin(OPERATOR, { role: 'super_admin' });
    await insertAdmin(TARGET, { role: 'viewer' });
    const operator = snapshotOf(OPERATOR, 'super_admin');

    const result = await commit(
      prepareRoleChange(OPERATOR, TARGET, {
        from: 'viewer',
        to: 'super_admin',
      }),
      {
        kind: 'role-change',
        operator,
        targetId: adminIdOf(TARGET),
        fromRole: 'viewer',
        toRole: 'super_admin',
      },
      changeRole(TARGET, 'super_admin'),
    );

    expect(result).toBe('committed');
    expect(await readAdmin(TARGET)).toEqual({
      role: 'super_admin',
      status: 'active',
    });
    expect((await readLogs()).map((log) => log.detail)).toEqual([
      { fromRole: 'viewer', toRole: 'super_admin' },
    ]);
  });

  test('他に有効な最上位管理者がいれば、自分自身を降格できる', async () => {
    await insertAdmin(OPERATOR, { role: 'super_admin' });
    await insertAdmin(OTHER, { role: 'super_admin' });

    const result = await commit(
      prepareRoleChange(OPERATOR, OPERATOR, {
        from: 'super_admin',
        to: 'moderator',
      }),
      {
        kind: 'role-change',
        operator: snapshotOf(OPERATOR, 'super_admin'),
        targetId: adminIdOf(OPERATOR),
        fromRole: 'super_admin',
        toRole: 'moderator',
      },
      changeRole(OPERATOR, 'moderator'),
    );

    expect(result).toBe('committed');
    expect(await readAdmin(OPERATOR)).toEqual({
      role: 'moderator',
      status: 'active',
    });
  });

  test.each([
    {
      name: '最後の有効な最上位管理者の自己降格',
      setup: async () => {
        await insertAdmin(OPERATOR, { role: 'super_admin' });
        await insertAdmin(OTHER, {
          role: 'super_admin',
          status: 'invited',
          activatedAt: null,
        });
      },
      operator: snapshotOf(OPERATOR, 'super_admin'),
      target: OPERATOR,
      fromRole: 'super_admin',
    },
    {
      name: 'モデレーターの操作者',
      setup: async () => {
        await insertAdmin(OPERATOR, { role: 'moderator' });
        await insertAdmin(TARGET, { role: 'viewer' });
      },
      operator: snapshotOf(OPERATOR, 'moderator'),
      target: TARGET,
      fromRole: 'viewer',
    },
    {
      name: '対象が存在しない',
      setup: async () => {
        await insertAdmin(OPERATOR, { role: 'super_admin' });
      },
      operator: snapshotOf(OPERATOR, 'super_admin'),
      target: TARGET,
      fromRole: 'viewer',
    },
    {
      name: '操作者が既に降格されている',
      setup: async () => {
        await insertAdmin(OPERATOR, { role: 'moderator' });
        await insertAdmin(TARGET, { role: 'super_admin' });
      },
      operator: snapshotOf(OPERATOR, 'super_admin'),
      target: TARGET,
      fromRole: 'super_admin',
    },
    {
      name: '対象のロールが読み取った変更前のロールと異なる',
      setup: async () => {
        await insertAdmin(OPERATOR, { role: 'super_admin' });
        await insertAdmin(TARGET, { role: 'moderator' });
      },
      operator: snapshotOf(OPERATOR, 'super_admin'),
      target: TARGET,
      fromRole: 'super_admin',
    },
  ] satisfies readonly {
    readonly name: string;
    readonly setup: () => Promise<void>;
    readonly operator: AdminSnapshot;
    readonly target: number;
    readonly fromRole: AdminRole;
  }[])(
    '$nameは全体が取り消され、監査ログもロールの変更も残らない',
    async ({ setup, operator, target, fromRole }) => {
      await setup();
      const before = await readAdmin(target);

      const result = await commit(
        prepareRoleChange(OPERATOR, target, {
          from: fromRole,
          to: 'viewer',
        }),
        {
          kind: 'role-change',
          operator,
          targetId: adminIdOf(target),
          fromRole,
          toRole: 'viewer',
        },
        changeRole(target, 'viewer'),
      );

      expect(result).toBe('rejected');
      expect(await readAdmin(target)).toEqual(before);
      expect(await readLogs()).toEqual([]);
      expect(await readTargets()).toEqual([]);
    },
  );

  test('2人の最上位管理者が互いを同時に降格しても、有効な最上位管理者が1人残る', async () => {
    await insertAdmin(OPERATOR, { role: 'super_admin' });
    await insertAdmin(TARGET, { role: 'super_admin' });
    const demote = (operatorIndex: number, targetIndex: number) =>
      commit(
        prepareRoleChange(
          operatorIndex,
          targetIndex,
          { from: 'super_admin', to: 'viewer' },
          operatorIndex,
        ),
        {
          kind: 'role-change',
          operator: snapshotOf(operatorIndex, 'super_admin'),
          targetId: adminIdOf(targetIndex),
          fromRole: 'super_admin',
          toRole: 'viewer',
        },
        changeRole(targetIndex, 'viewer'),
      );

    const results = await Promise.all([
      demote(OPERATOR, TARGET),
      demote(TARGET, OPERATOR),
    ]);

    expect([...results].sort()).toEqual(['committed', 'rejected']);
    const superAdmins = await db
      .select({ id: admins.id })
      .from(admins)
      .where(eq(admins.role, 'super_admin'));
    expect(superAdmins).toHaveLength(1);
    expect(await readLogs()).toHaveLength(1);
  });
});

describe('buildAuditLogStatements(SQLで渡す条件付きの記録)', () => {
  const targetRoleIs = (role: AdminRole): AuditGuard => ({
    kind: 'condition',
    condition: sql`EXISTS (SELECT 1 FROM ${admins} WHERE ${admins.id} = ${adminIdOf(TARGET)} AND ${admins.role} = ${role})`,
  });

  async function promoteTarget(guard: AuditGuard | undefined) {
    await clearAdminTables();
    await insertAdmin(OPERATOR, { role: 'super_admin' });
    await insertAdmin(TARGET, { role: 'viewer' });
    const result = await commit(
      prepareRoleChange(OPERATOR, TARGET, { from: 'viewer', to: 'moderator' }),
      guard,
      changeRole(TARGET, 'moderator'),
    );
    return {
      result,
      logs: await readLogs(),
      targets: await readTargets(),
      target: await readAdmin(TARGET),
    };
  }

  test('条件が真なら、条件なしと同じ監査ログ・対象・他の文の結果がそろって確定する', async () => {
    const withoutGuard = await promoteTarget(undefined);

    const withCondition = await promoteTarget(targetRoleIs('viewer'));

    expect(withCondition.result).toBe('committed');
    expect(withCondition.target).toEqual({
      role: 'moderator',
      status: 'active',
    });
    expect(withCondition).toEqual(withoutGuard);
  });

  test('条件が偽なら取り消しとして見分けられ、監査ログも対象も同じ一括の書き込みの他の文の結果も残らない', async () => {
    await insertAdmin(OPERATOR, { role: 'super_admin' });
    await insertAdmin(TARGET, { role: 'moderator' });
    const entry = prepareRoleChange(OPERATOR, TARGET, {
      from: 'viewer',
      to: 'super_admin',
    });

    const error: unknown = await db
      .batch([
        ...buildAuditLogStatements(db, entry, targetRoleIs('viewer')),
        changeRole(TARGET, 'super_admin'),
      ])
      .catch((caught: unknown) => caught);

    expect(isAuditGuardRejection(error)).toBe(true);
    expect(await readAdmin(TARGET)).toEqual({
      role: 'moderator',
      status: 'active',
    });
    expect(await readLogs()).toEqual([]);
    expect(await readTargets()).toEqual([]);
  });
});
