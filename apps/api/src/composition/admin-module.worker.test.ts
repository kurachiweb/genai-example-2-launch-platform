import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { ADMIN_ACCOUNT_DELETE_ACTION } from '../../common-lib/admin/audit-actions/admin-foundation.ts';
import { adminSessions } from '../../db/schema/admin/admin-sessions.ts';
import {
  createAdminGateway,
  createAdminTestContainer,
  issueAdminSession,
} from '../../test/support/admin-graphql-harness.ts';
import { StoreAdminAuthorizer } from '../application/admin/admin-authorizer.ts';
import {
  ADMIN_SESSION_USER_AGENT_MAX_LENGTH,
  StoreAdminSessionIssuer,
} from '../application/admin/admin-session-issuer.ts';
import { AdminSessionVerifier } from '../application/admin/admin-session-verifier.ts';
import { ADMIN_TYPES } from '../application/admin/admin-types.ts';
import { AUTH_TYPES } from '../application/auth/auth-types.ts';
import {
  SESSION_TYPES,
  type SessionVerification,
  type SessionVerifier,
} from '../application/session/session-verifier.ts';
import { D1AdminAccountStore } from '../infrastructure/admin/d1-admin-account-store.ts';
import { D1AdminSessionStore } from '../infrastructure/admin/d1-admin-session-store.ts';
import {
  adminIdOf,
  adminSnapshotOf,
  auditLogIdOf,
  clearAdminTables,
  createAuditLogRecorder,
  db,
  insertAdmin,
  insertInvitedAdmin,
  readAdminSessionIdsOf,
} from '../infrastructure/admin/testing/admin-store-fixtures.ts';
import type { GraphQLContext } from '../presentation/graphql/graphql-context.ts';
import { USER_AGENT_MAX_LENGTH } from '../presentation/graphql/graphql-module.ts';
import { defineSchemaModule } from '../presentation/graphql/schema-module.ts';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const HOUR_SECONDS = 60 * 60;

const ADMIN = 1;
const OPERATOR = 2;

const minutesAgo = (minutes: number): Date =>
  new Date(Date.now() - minutes * MINUTE_MS);

function verifyAdminToken(token: string): Promise<SessionVerification> {
  return createAdminTestContainer()
    .get<SessionVerifier>(SESSION_TYPES.SessionVerifier)
    .verify({ subjectKind: 'admin', token });
}

async function readLastUsedAt(sessionId: string): Promise<Date | undefined> {
  const [row] = await db
    .select({ lastUsedAt: adminSessions.lastUsedAt })
    .from(adminSessions)
    .where(eq(adminSessions.id, sessionId));
  return row?.lastUsedAt;
}

beforeEach(async () => {
  await clearAdminTables();
});

describe('APIサーバーの管理者のセッションの束縛', () => {
  test.each([
    ['AdminSessionStore', ADMIN_TYPES.AdminSessionStore, D1AdminSessionStore],
    [
      'AdminSessionIssuer',
      ADMIN_TYPES.AdminSessionIssuer,
      StoreAdminSessionIssuer,
    ],
    [
      'AdminSessionVerifier',
      ADMIN_TYPES.AdminSessionVerifier,
      AdminSessionVerifier,
    ],
    ['AdminAccountStore', ADMIN_TYPES.AdminAccountStore, D1AdminAccountStore],
    ['AdminAuthorizer', ADMIN_TYPES.AdminAuthorizer, StoreAdminAuthorizer],
  ] as const)(
    '処理単位のコンテナから%sを解決する',
    (_name, identifier, implementation) => {
      expect(createAdminTestContainer().get(identifier)).toBeInstanceOf(
        implementation,
      );
    },
  );

  test('アクセス制御の部品は保存済みのロールの読み取りを要求の中で使い回すため、処理単位の中では同じインスタンスを返し、別の処理単位では別のインスタンスを返す', () => {
    const container = createAdminTestContainer();

    expect(container.get(ADMIN_TYPES.AdminAuthorizer)).toBe(
      container.get(ADMIN_TYPES.AdminAuthorizer),
    );
    expect(container.get(ADMIN_TYPES.AdminAuthorizer)).not.toBe(
      createAdminTestContainer().get(ADMIN_TYPES.AdminAuthorizer),
    );
  });

  test('認証部品の管理者のセッションの検証は、管理者のモジュールの検証へ転送する', () => {
    expect(
      createAdminTestContainer().get(AUTH_TYPES.AdminSessionVerifier),
    ).toBeInstanceOf(AdminSessionVerifier);
  });

  test('保存するUser-Agentの上限は、受付経路が切り詰める長さと一致する', () => {
    expect(ADMIN_SESSION_USER_AGENT_MAX_LENGTH).toBe(USER_AGENT_MAX_LENGTH);
  });
});

describe('APIサーバーの管理者のセッションの検証', () => {
  test('有効な管理者の発行したばかりのセッションは、管理者の主体として有効になり、延長を指示しない', async () => {
    await insertAdmin(ADMIN);
    const issued = await issueAdminSession(adminIdOf(ADMIN));

    const result = await verifyAdminToken(issued.token);

    expect(result).toEqual({
      status: 'valid',
      principal: {
        kind: 'authenticated',
        subjectKind: 'admin',
        subjectId: adminIdOf(ADMIN),
        sessionId: issued.sessionId,
      },
    });
  });

  test('最後の利用から5分以上の間隔で利用すると、最終利用日時を更新し、同じトークンで期限の延長を指示する', async () => {
    await insertAdmin(ADMIN);
    const issuedAt = minutesAgo(6);
    const issued = await issueAdminSession(adminIdOf(ADMIN), {
      now: issuedAt,
    });

    const result = await verifyAdminToken(issued.token);

    expect(result).toMatchObject({
      status: 'valid',
      renewal: { token: issued.token },
    });
    const maxAgeSeconds =
      result.status === 'valid' ? result.renewal?.maxAgeSeconds : undefined;
    expect(maxAgeSeconds).toBeGreaterThan(HOUR_SECONDS - 60);
    expect(maxAgeSeconds).toBeLessThanOrEqual(HOUR_SECONDS);
    const lastUsedAt = await readLastUsedAt(issued.sessionId);
    expect(lastUsedAt?.getTime()).toBeGreaterThan(issuedAt.getTime());
  });

  test('最後の利用から5分未満なら、最終利用日時を変えずに延長も指示しない', async () => {
    await insertAdmin(ADMIN);
    const issuedAt = minutesAgo(4);
    const issued = await issueAdminSession(adminIdOf(ADMIN), {
      now: issuedAt,
    });

    const result = await verifyAdminToken(issued.token);

    expect(result.status).toBe('valid');
    expect(result).not.toHaveProperty('renewal');
    expect(await readLastUsedAt(issued.sessionId)).toEqual(issuedAt);
  });

  test('最後の利用からアイドルの1時間を過ぎたセッションは無効になり、行が消える', async () => {
    await insertAdmin(ADMIN);
    const issued = await issueAdminSession(adminIdOf(ADMIN), {
      now: minutesAgo(61),
    });

    const result = await verifyAdminToken(issued.token);

    expect(result).toEqual({ status: 'invalid' });
    expect(await readAdminSessionIdsOf(ADMIN)).toEqual([]);
  });

  test('利用が続いていても発行から絶対の12時間を過ぎたセッションは無効になり、行が消える', async () => {
    await insertAdmin(ADMIN);
    const issued = await issueAdminSession(adminIdOf(ADMIN), {
      now: new Date(Date.now() - 12 * HOUR_MS - MINUTE_MS),
    });
    await db
      .update(adminSessions)
      .set({ lastUsedAt: minutesAgo(1) })
      .where(eq(adminSessions.id, issued.sessionId));

    const result = await verifyAdminToken(issued.token);

    expect(result).toEqual({ status: 'invalid' });
    expect(await readAdminSessionIdsOf(ADMIN)).toEqual([]);
  });

  test('招待中の管理者のセッションは無効になり、行が消える', async () => {
    await insertInvitedAdmin(ADMIN);
    const issued = await issueAdminSession(adminIdOf(ADMIN));

    const result = await verifyAdminToken(issued.token);

    expect(result).toEqual({ status: 'invalid' });
    expect(await readAdminSessionIdsOf(ADMIN)).toEqual([]);
  });

  test('削除した管理者のセッションは無効になり、行が残らない', async () => {
    await insertAdmin(OPERATOR, { role: 'super_admin' });
    await insertAdmin(ADMIN);
    const issued = await issueAdminSession(adminIdOf(ADMIN));
    const audit = createAuditLogRecorder({
      ids: { generate: () => auditLogIdOf(1) },
    }).prepare({
      operatorAdminId: adminIdOf(OPERATOR),
      action: ADMIN_ACCOUNT_DELETE_ACTION.name,
      targetIds: [adminIdOf(ADMIN)],
      occurredAt: new Date(),
    });
    await expect(
      new D1AdminAccountStore(db).deleteGuarded(
        adminSnapshotOf(OPERATOR, 'super_admin'),
        adminIdOf(ADMIN),
        audit,
      ),
    ).resolves.toBe('deleted');

    const result = await verifyAdminToken(issued.token);

    expect(result).toEqual({ status: 'invalid' });
    expect(await readAdminSessionIdsOf(ADMIN)).toEqual([]);
  });

  test('利用者のセッションとして検証すると、管理者のセッションは無効になり、行は消えない', async () => {
    await insertAdmin(ADMIN);
    const issued = await issueAdminSession(adminIdOf(ADMIN));

    const result = await createAdminTestContainer()
      .get<SessionVerifier>(SESSION_TYPES.SessionVerifier)
      .verify({ subjectKind: 'user', token: issued.token });

    expect(result).toEqual({ status: 'invalid' });
    expect(await readAdminSessionIdsOf(ADMIN)).toEqual([issued.sessionId]);
  });
});

const SESSION_PRINCIPAL = /* GraphQL */ `
  query SessionPrincipal {
    sessionPrincipal {
      subjectKind
      subjectId
    }
  }
`;

const sessionPrincipalModule = defineSchemaModule({
  name: 'admin-session-principal-fixture',
  typeDefs: /* GraphQL */ `
    type SessionPrincipal {
      subjectKind: String!
      subjectId: String!
    }

    type Query {
      sessionPrincipal: SessionPrincipal
    }
  `,
  resolvers: {
    Query: {
      sessionPrincipal: async (
        _parent: unknown,
        _args: unknown,
        context: GraphQLContext,
      ) => {
        const principal = await context.session.principal();
        return principal.kind === 'authenticated' ? principal : null;
      },
    },
  },
});

describe('呼び出し元ごとのGraphQLでの管理者のセッション', () => {
  const gateway = createAdminGateway({
    documents: [SESSION_PRINCIPAL],
    schemaModules: [sessionPrincipalModule],
  });

  test('管理者側の呼び出し元は、発行した管理者のセッションから管理者の主体を得る', async () => {
    await insertAdmin(ADMIN);
    const issued = await issueAdminSession(adminIdOf(ADMIN));

    const response = await gateway.call(
      SESSION_PRINCIPAL,
      {},
      { sessionToken: issued.token },
    );

    expect(response.errors).toBeUndefined();
    expect(response.data).toEqual({
      sessionPrincipal: { subjectKind: 'admin', subjectId: adminIdOf(ADMIN) },
    });
    expect(response.cleared).toBe(false);
  });

  test('管理者側の呼び出し元で5分以上の間隔で利用すると、同じトークンの延長を応答で指示する', async () => {
    await insertAdmin(ADMIN);
    const issued = await issueAdminSession(adminIdOf(ADMIN), {
      now: minutesAgo(6),
    });

    const response = await gateway.call(
      SESSION_PRINCIPAL,
      {},
      { sessionToken: issued.token },
    );

    expect(response.data).toEqual({
      sessionPrincipal: { subjectKind: 'admin', subjectId: adminIdOf(ADMIN) },
    });
    expect(response.issuedToken).toBe(issued.token);
  });

  test('利用者側の呼び出し元では、管理者のセッションは無効になり主体を得られない', async () => {
    await insertAdmin(ADMIN);
    const issued = await issueAdminSession(adminIdOf(ADMIN));

    const response = await gateway.call(
      SESSION_PRINCIPAL,
      {},
      { caller: 'client', sessionToken: issued.token },
    );

    expect(response.data).toEqual({ sessionPrincipal: null });
    expect(response.cleared).toBe(true);
    expect(await readAdminSessionIdsOf(ADMIN)).toEqual([issued.sessionId]);
  });

  test('管理者側の呼び出し元で期限切れのセッションを渡すと、主体を得られずCookieの削除を指示する', async () => {
    await insertAdmin(ADMIN);
    const issued = await issueAdminSession(adminIdOf(ADMIN), {
      now: minutesAgo(61),
    });

    const response = await gateway.call(
      SESSION_PRINCIPAL,
      {},
      { sessionToken: issued.token },
    );

    expect(response.data).toEqual({ sessionPrincipal: null });
    expect(response.cleared).toBe(true);
    expect(await readAdminSessionIdsOf(ADMIN)).toEqual([]);
  });
});
