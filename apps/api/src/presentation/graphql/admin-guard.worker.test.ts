import { beforeEach, describe, expect, test } from 'vitest';

import type { AdminRole } from '../../../common-lib/admin/admin-roles.ts';
import { ADMIN_ACCOUNT_ROLE_CHANGE_ACTION } from '../../../common-lib/admin/audit-actions/admin-foundation.ts';
import {
  createAdminGateway,
  issueAdminSession,
} from '../../../test/support/admin-graphql-harness.ts';
import type { GatewayResponse } from '../../../test/support/graphql-gateway.ts';
import { D1AdminAccountStore } from '../../infrastructure/admin/d1-admin-account-store.ts';
import {
  adminIdOf,
  adminSnapshotOf,
  after,
  auditLogIdOf,
  clearAdminTables,
  createAuditLogRecorder,
  db,
  insertAdmin,
} from '../../infrastructure/admin/testing/admin-store-fixtures.ts';
import { requireAdmin, requireSelfOrRole } from './admin-guard.ts';
import type { GraphQLContext } from './graphql-context.ts';
import { defineSchemaModule } from './schema-module.ts';

const SUPER_ADMIN = 1;
const ADMIN = 2;

const MODERATOR_ONLY = /* GraphQL */ `
  query ModeratorOnly {
    moderatorOnly {
      id
      role
      nickname
      sessionId
    }
  }
`;

const OWNED_BY = /* GraphQL */ `
  query OwnedBy($ownerAdminId: String!) {
    ownedBy(ownerAdminId: $ownerAdminId) {
      id
      role
    }
  }
`;

const adminGuardModule = defineSchemaModule({
  name: 'admin-guard-fixture',
  typeDefs: /* GraphQL */ `
    type AdminGuardResult {
      id: String!
      role: String!
      nickname: String!
      sessionId: String!
    }

    type Query {
      moderatorOnly: AdminGuardResult!
      ownedBy(ownerAdminId: String!): AdminGuardResult!
    }
  `,
  resolvers: {
    Query: {
      moderatorOnly: (
        _parent: unknown,
        _args: unknown,
        context: GraphQLContext,
      ) => requireAdmin(context, 'moderator'),
      ownedBy: (
        _parent: unknown,
        args: { readonly ownerAdminId: string },
        context: GraphQLContext,
      ) => requireSelfOrRole(context, args.ownerAdminId, 'super_admin'),
    },
  },
});

const gateway = createAdminGateway({
  documents: [MODERATOR_ONLY, OWNED_BY],
  schemaModules: [adminGuardModule],
});

const store = new D1AdminAccountStore(db);

function codesOf(response: GatewayResponse): readonly (string | undefined)[] {
  return (response.errors ?? []).map((error) => error.extensions?.code);
}

// 本物のストアのロールの変更(監査ログの記録を含む一括の書き込み)で、最上位管理者が対象のロールを変える
async function changeRole(
  targetIndex: number,
  roles: { readonly from: AdminRole; readonly to: AdminRole },
): Promise<void> {
  const entry = createAuditLogRecorder({
    ids: { generate: () => auditLogIdOf(targetIndex) },
  }).prepare({
    operatorAdminId: adminIdOf(SUPER_ADMIN),
    action: ADMIN_ACCOUNT_ROLE_CHANGE_ACTION.name,
    targetIds: [adminIdOf(targetIndex)],
    detail: { fromRole: roles.from, toRole: roles.to },
    occurredAt: after(60_000),
  });
  await expect(
    store.changeRoleGuarded(
      adminSnapshotOf(SUPER_ADMIN, 'super_admin'),
      {
        targetId: adminIdOf(targetIndex),
        fromRole: roles.from,
        toRole: roles.to,
      },
      entry,
    ),
  ).resolves.toBe('changed');
}

beforeEach(async () => {
  await clearAdminTables();
  await insertAdmin(SUPER_ADMIN, { role: 'super_admin' });
});

describe('requireAdmin', () => {
  test('最低限のロールを満たす管理者には、管理者のID・ロール・ニックネーム・セッションのIDを返す', async () => {
    await insertAdmin(ADMIN, { role: 'moderator' });
    const issued = await issueAdminSession(adminIdOf(ADMIN));

    const response = await gateway.call(
      MODERATOR_ONLY,
      {},
      { sessionToken: issued.token },
    );

    expect(response.errors).toBeUndefined();
    expect(response.data).toEqual({
      moderatorOnly: {
        id: adminIdOf(ADMIN),
        role: 'moderator',
        nickname: `管理者${String(ADMIN)}`,
        sessionId: issued.sessionId,
      },
    });
  });

  // GraphQLの応答は状態コードを200のままにし、403に当たる拒否をエラーのコードで示す
  test('最低限のロールに満たない管理者の操作は、403に当たる禁止のコードで拒否し、データを返さない', async () => {
    await insertAdmin(ADMIN, { role: 'viewer' });
    const issued = await issueAdminSession(adminIdOf(ADMIN));

    const response = await gateway.call(
      MODERATOR_ONLY,
      {},
      { sessionToken: issued.token },
    );

    expect(codesOf(response)).toEqual(['forbidden']);
    expect(response.data).toBeNull();
  });

  test('ロールを上げた直後の要求から、同じセッションのまま新しいロールで許可する', async () => {
    await insertAdmin(ADMIN, { role: 'viewer' });
    const issued = await issueAdminSession(adminIdOf(ADMIN));
    const before = await gateway.call(
      MODERATOR_ONLY,
      {},
      { sessionToken: issued.token },
    );
    expect(codesOf(before)).toEqual(['forbidden']);

    await changeRole(ADMIN, { from: 'viewer', to: 'moderator' });
    const afterChange = await gateway.call(
      MODERATOR_ONLY,
      {},
      { sessionToken: issued.token },
    );

    expect(afterChange.errors).toBeUndefined();
    expect(afterChange.data).toMatchObject({
      moderatorOnly: { id: adminIdOf(ADMIN), role: 'moderator' },
    });
  });

  test('ロールを下げた直後の要求から、同じセッションのまま新しいロールで拒否する', async () => {
    await insertAdmin(ADMIN, { role: 'moderator' });
    const issued = await issueAdminSession(adminIdOf(ADMIN));
    const before = await gateway.call(
      MODERATOR_ONLY,
      {},
      { sessionToken: issued.token },
    );
    expect(before.errors).toBeUndefined();

    await changeRole(ADMIN, { from: 'moderator', to: 'viewer' });
    const afterChange = await gateway.call(
      MODERATOR_ONLY,
      {},
      { sessionToken: issued.token },
    );

    expect(codesOf(afterChange)).toEqual(['forbidden']);
  });

  test('利用者側の呼び出し元からの要求は、最上位管理者のセッションでも拒否する', async () => {
    const issued = await issueAdminSession(adminIdOf(SUPER_ADMIN));

    const response = await gateway.call(
      MODERATOR_ONLY,
      {},
      { caller: 'client', sessionToken: issued.token },
    );

    expect(codesOf(response)).toEqual(['forbidden']);
  });

  test('管理者のセッションで認証されていない要求は、未認証として拒否する', async () => {
    const response = await gateway.call(MODERATOR_ONLY);

    expect(codesOf(response)).toEqual(['unauthenticated']);
  });
});

describe('requireSelfOrRole', () => {
  test('対象の所有者本人なら、最低限のロールに満たなくても許可する', async () => {
    await insertAdmin(ADMIN, { role: 'viewer' });
    const issued = await issueAdminSession(adminIdOf(ADMIN));

    const response = await gateway.call(
      OWNED_BY,
      { ownerAdminId: adminIdOf(ADMIN) },
      { sessionToken: issued.token },
    );

    expect(response.errors).toBeUndefined();
    expect(response.data).toEqual({
      ownedBy: { id: adminIdOf(ADMIN), role: 'viewer' },
    });
  });

  test('本人でなければ最低限のロールを求め、満たさなければ拒否する', async () => {
    await insertAdmin(ADMIN, { role: 'moderator' });
    const issued = await issueAdminSession(adminIdOf(ADMIN));

    const response = await gateway.call(
      OWNED_BY,
      { ownerAdminId: adminIdOf(SUPER_ADMIN) },
      { sessionToken: issued.token },
    );

    expect(codesOf(response)).toEqual(['forbidden']);
  });

  test('本人でなくても最低限のロールを満たせば許可する', async () => {
    await insertAdmin(ADMIN, { role: 'viewer' });
    const issued = await issueAdminSession(adminIdOf(SUPER_ADMIN));

    const response = await gateway.call(
      OWNED_BY,
      { ownerAdminId: adminIdOf(ADMIN) },
      { sessionToken: issued.token },
    );

    expect(response.data).toEqual({
      ownedBy: { id: adminIdOf(SUPER_ADMIN), role: 'super_admin' },
    });
  });

  test('利用者側の呼び出し元からの要求は、本人の対象でも拒否する', async () => {
    await insertAdmin(ADMIN, { role: 'viewer' });
    const issued = await issueAdminSession(adminIdOf(ADMIN));

    const response = await gateway.call(
      OWNED_BY,
      { ownerAdminId: adminIdOf(ADMIN) },
      { caller: 'client', sessionToken: issued.token },
    );

    expect(codesOf(response)).toEqual(['forbidden']);
  });
});
