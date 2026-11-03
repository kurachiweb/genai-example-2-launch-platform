import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import type { AdminRole } from '../../../common-lib/admin/admin-roles.ts';
import {
  ADMIN_ACCOUNT_DELETE_ACTION,
  ADMIN_ACCOUNT_ROLE_CHANGE_ACTION,
} from '../../../common-lib/admin/audit-actions/admin-foundation.ts';
import { admins } from '../../../db/schema/admin/admins.ts';
import type { PreparedAuditEntry } from '../../application/admin/audit-log-recorder.ts';
import { D1AdminAccountStore } from './d1-admin-account-store.ts';
import {
  adminIdOf,
  adminSnapshotOf,
  after,
  auditLogIdOf,
  clearAdminTables,
  countAdminChildRows,
  createAuditLogRecorder,
  db,
  insertAdmin,
  insertAdminChildRows,
  insertAdminToken,
  insertInvitedAdmin,
  readAdminRow,
  readAuditLogSummaries,
  readAuditLogTargetIds,
} from './testing/admin-store-fixtures.ts';

const AT = after(60_000);

const OPERATOR = 1;

const TARGET = 2;

const ALL_CHILD_ROWS = {
  sessions: 1,
  tokens: 1,
  challenges: 1,
  totp: 1,
  recovery: 1,
};

const NO_CHILD_ROWS = {
  sessions: 0,
  tokens: 0,
  challenges: 0,
  totp: 0,
  recovery: 0,
};

const store = new D1AdminAccountStore(db);

function prepareDelete(
  operatorIndex: number,
  targetIndex: number,
  logIndex = 1,
): PreparedAuditEntry {
  return createAuditLogRecorder({
    ids: { generate: () => auditLogIdOf(logIndex) },
  }).prepare({
    operatorAdminId: adminIdOf(operatorIndex),
    action: ADMIN_ACCOUNT_DELETE_ACTION.name,
    targetIds: [adminIdOf(targetIndex)],
    occurredAt: AT,
  });
}

function changeRole(
  operatorIndex: number,
  targetIndex: number,
  roles: { readonly from: AdminRole; readonly to: AdminRole },
  operatorRole: AdminRole = 'super_admin',
) {
  const entry = createAuditLogRecorder({
    ids: { generate: () => auditLogIdOf(operatorIndex) },
  }).prepare({
    operatorAdminId: adminIdOf(operatorIndex),
    action: ADMIN_ACCOUNT_ROLE_CHANGE_ACTION.name,
    targetIds: [adminIdOf(targetIndex)],
    detail: { fromRole: roles.from, toRole: roles.to },
    occurredAt: AT,
  });
  return store.changeRoleGuarded(
    adminSnapshotOf(operatorIndex, operatorRole),
    {
      targetId: adminIdOf(targetIndex),
      fromRole: roles.from,
      toRole: roles.to,
    },
    entry,
  );
}

function countActiveSuperAdmins(): Promise<number> {
  return db.$count(
    admins,
    and(eq(admins.role, 'super_admin'), eq(admins.status, 'active')),
  );
}

beforeEach(async () => {
  await clearAdminTables();
});

describe('D1AdminAccountStore.deleteGuarded', () => {
  test('管理者と子の行(セッション・トークン・第2要素の待ち・TOTP・リカバリコード)をすべて消し、監査ログを記録する', async () => {
    await insertAdmin(OPERATOR, { role: 'moderator' });
    await insertAdmin(TARGET, { role: 'moderator' });
    await insertAdminChildRows(TARGET);
    await insertAdminChildRows(OPERATOR);

    const result = await store.deleteGuarded(
      adminSnapshotOf(OPERATOR, 'moderator'),
      adminIdOf(TARGET),
      prepareDelete(OPERATOR, TARGET),
    );

    expect(result).toBe('deleted');
    expect(await readAdminRow(TARGET)).toBeUndefined();
    expect(await countAdminChildRows(TARGET)).toEqual(NO_CHILD_ROWS);
    expect(await countAdminChildRows(OPERATOR)).toEqual(ALL_CHILD_ROWS);
    expect(await readAuditLogSummaries()).toEqual([
      {
        id: auditLogIdOf(1),
        operatorAdminId: adminIdOf(OPERATOR),
        action: ADMIN_ACCOUNT_DELETE_ACTION.name,
        detail: {},
      },
    ]);
    expect(await readAuditLogTargetIds()).toEqual([adminIdOf(TARGET)]);
  });

  test('招待中の管理者を削除すると、未使用の招待のトークンも消える', async () => {
    await insertAdmin(OPERATOR, { role: 'moderator' });
    await insertInvitedAdmin(TARGET);
    await insertAdminToken(TARGET, 'invitation', 'invitation-hash');

    const result = await store.deleteGuarded(
      adminSnapshotOf(OPERATOR, 'moderator'),
      adminIdOf(TARGET),
      prepareDelete(OPERATOR, TARGET),
    );

    expect(result).toBe('deleted');
    expect(await readAdminRow(TARGET)).toBeUndefined();
    expect(await countAdminChildRows(TARGET)).toEqual(NO_CHILD_ROWS);
  });

  test('最後の有効な最上位管理者の削除は全体が取り消され、子の行が残り監査ログは残らずにrejectedを返す', async () => {
    // 操作者は読み取った後に降格され、対象が唯一の有効な最上位管理者になっている
    await insertAdmin(OPERATOR, { role: 'moderator' });
    await insertAdmin(TARGET, { role: 'super_admin' });
    await insertAdminChildRows(TARGET);

    const result = await store.deleteGuarded(
      adminSnapshotOf(OPERATOR, 'super_admin'),
      adminIdOf(TARGET),
      prepareDelete(OPERATOR, TARGET),
    );

    expect(result).toBe('rejected');
    expect((await readAdminRow(TARGET))?.role).toBe('super_admin');
    expect(await countAdminChildRows(TARGET)).toEqual(ALL_CHILD_ROWS);
    expect(await readAuditLogSummaries()).toEqual([]);
    expect(await readAuditLogTargetIds()).toEqual([]);
  });

  test('存在しない管理者の削除はrejectedを返す', async () => {
    await insertAdmin(OPERATOR, { role: 'moderator' });

    const result = await store.deleteGuarded(
      adminSnapshotOf(OPERATOR, 'moderator'),
      adminIdOf(TARGET),
      prepareDelete(OPERATOR, TARGET),
    );

    expect(result).toBe('rejected');
    expect(await readAuditLogSummaries()).toEqual([]);
  });

  test('2人の最上位管理者が互いを同時に削除しても、有効な最上位管理者が1人残る', async () => {
    await insertAdmin(OPERATOR, { role: 'super_admin' });
    await insertAdmin(TARGET, { role: 'super_admin' });

    const results = await Promise.all([
      store.deleteGuarded(
        adminSnapshotOf(OPERATOR, 'super_admin'),
        adminIdOf(TARGET),
        prepareDelete(OPERATOR, TARGET, 1),
      ),
      store.deleteGuarded(
        adminSnapshotOf(TARGET, 'super_admin'),
        adminIdOf(OPERATOR),
        prepareDelete(TARGET, OPERATOR, 2),
      ),
    ]);

    expect([...results].sort()).toEqual(['deleted', 'rejected']);
    expect(await countActiveSuperAdmins()).toBe(1);
    expect(await readAuditLogSummaries()).toHaveLength(1);
  });
});

describe('D1AdminAccountStore.changeRoleGuarded', () => {
  test('ロールを変え、変更前後のロールを詳細に持つ監査ログを記録する', async () => {
    await insertAdmin(OPERATOR, { role: 'super_admin' });
    await insertAdmin(TARGET, { role: 'viewer' });

    const result = await changeRole(OPERATOR, TARGET, {
      from: 'viewer',
      to: 'moderator',
    });

    expect(result).toBe('changed');
    expect((await readAdminRow(TARGET))?.role).toBe('moderator');
    expect(await readAuditLogSummaries()).toEqual([
      {
        id: auditLogIdOf(OPERATOR),
        operatorAdminId: adminIdOf(OPERATOR),
        action: ADMIN_ACCOUNT_ROLE_CHANGE_ACTION.name,
        detail: { fromRole: 'viewer', toRole: 'moderator' },
      },
    ]);
    expect(await readAuditLogTargetIds()).toEqual([adminIdOf(TARGET)]);
  });

  test('最後の有効な最上位管理者の降格は全体が取り消され、監査ログも残らずにrejectedを返す', async () => {
    await insertAdmin(OPERATOR, { role: 'super_admin' });

    const result = await changeRole(OPERATOR, OPERATOR, {
      from: 'super_admin',
      to: 'moderator',
    });

    expect(result).toBe('rejected');
    expect((await readAdminRow(OPERATOR))?.role).toBe('super_admin');
    expect(await readAuditLogSummaries()).toEqual([]);
    expect(await readAuditLogTargetIds()).toEqual([]);
  });

  test('対象のロールが読み取った後に変わっていれば、監査ログの変更前のロールが食い違うためrejectedを返す', async () => {
    await insertAdmin(OPERATOR, { role: 'super_admin' });
    await insertAdmin(TARGET, { role: 'moderator' });

    const result = await changeRole(OPERATOR, TARGET, {
      from: 'viewer',
      to: 'super_admin',
    });

    expect(result).toBe('rejected');
    expect((await readAdminRow(TARGET))?.role).toBe('moderator');
    expect(await readAuditLogSummaries()).toEqual([]);
  });

  test('最上位管理者でない操作者のロールの変更はrejectedを返す', async () => {
    await insertAdmin(OPERATOR, { role: 'moderator' });
    await insertAdmin(TARGET, { role: 'viewer' });

    const result = await changeRole(
      OPERATOR,
      TARGET,
      { from: 'viewer', to: 'moderator' },
      'moderator',
    );

    expect(result).toBe('rejected');
    expect((await readAdminRow(TARGET))?.role).toBe('viewer');
  });

  test('2人の最上位管理者が互いを同時に降格しても、有効な最上位管理者が1人残る', async () => {
    await insertAdmin(OPERATOR, { role: 'super_admin' });
    await insertAdmin(TARGET, { role: 'super_admin' });
    const demotion = { from: 'super_admin', to: 'viewer' } as const;

    const results = await Promise.all([
      changeRole(OPERATOR, TARGET, demotion),
      changeRole(TARGET, OPERATOR, demotion),
    ]);

    expect([...results].sort()).toEqual(['changed', 'rejected']);
    expect(await countActiveSuperAdmins()).toBe(1);
    expect(await readAuditLogSummaries()).toHaveLength(1);
  });
});
