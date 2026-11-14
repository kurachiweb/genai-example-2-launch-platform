import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { ADMIN_AVATAR_UPLOAD_PURPOSE } from '../../common-lib/admin/admin-avatar-upload.ts';
import { ADMIN_ACCOUNT_DELETE_ACTION } from '../../common-lib/admin/audit-actions/admin-foundation.ts';
import { AUDIT_ACTIONS } from '../../common-lib/admin/audit-actions/index.ts';
import type { AuditActionCatalog } from '../../common-lib/admin/audit-action.ts';
import { IMAGE_MEDIA_TYPES } from '../../common-lib/media/media-types.ts';
import { UPLOAD_FILE_NAME_HEADER } from '../../common-lib/media/upload-protocol.ts';
import { adminSessions } from '../../db/schema/admin/admin-sessions.ts';
import { ADMIN_PLATFORM_TYPES } from '../../lib/core/admin/identifiers.ts';
import { MEDIA_TYPES } from '../../lib/core/media/identifiers.ts';
import type { UploadPurposeRegistry } from '../../lib/core/media/upload-purpose.ts';
import { D1AdminDirectory } from '../../lib/workers/admin/d1-admin-directory.ts';
import {
  clearMediaState,
  countRecords,
  pngBytes,
} from '../../lib/workers/media/testing/upload-receiver-fixtures.ts';
import {
  createAdminGateway,
  createAdminTestContainer,
  issueAdminSession,
} from '../../test/support/admin-graphql-harness.ts';
import { callInternal } from '../../test/support/gateway-test-harness.ts';
import { StoreAdminAccountManagement } from '../application/admin/admin-account-management.ts';
import { StoreAdminAuthorizer } from '../application/admin/admin-authorizer.ts';
import { StoreAdminEmailChange } from '../application/admin/admin-email-change.ts';
import { StoreAdminInvitation } from '../application/admin/admin-invitation.ts';
import { StoreAdminLogin } from '../application/admin/admin-login.ts';
import { StoreAdminPasswordChange } from '../application/admin/admin-password-change.ts';
import { StoreAdminPasswordReset } from '../application/admin/admin-password-reset.ts';
import { StoreAdminProfile } from '../application/admin/admin-profile.ts';
import { StoreAdminReAuthenticator } from '../application/admin/admin-re-authenticator.ts';
import {
  ADMIN_SESSION_USER_AGENT_MAX_LENGTH,
  StoreAdminSessionIssuer,
} from '../application/admin/admin-session-issuer.ts';
import { AdminSessionVerifier } from '../application/admin/admin-session-verifier.ts';
import { StoreAdminTotpManagement } from '../application/admin/admin-totp-management.ts';
import { ADMIN_TYPES } from '../application/admin/admin-types.ts';
import { StoreAuditLogReader } from '../application/admin/audit-log-reader.ts';
import { StoreAuditLogRecorder } from '../application/admin/audit-log-recorder.ts';
import { AdminCredentialCleanupJob } from '../application/admin/jobs/admin-credential-cleanup-job.ts';
import { AuditLogRetentionJob } from '../application/admin/jobs/audit-log-retention-job.ts';
import type { AdminSettings } from '../application/admin/ports.ts';
import { AUTH_TYPES } from '../application/auth/auth-types.ts';
import {
  SESSION_TYPES,
  type SessionVerification,
  type SessionVerifier,
} from '../application/session/session-verifier.ts';
import { CounterAdminMailSendLimits } from '../infrastructure/admin/counter-admin-mail-send-limits.ts';
import { D1AdminAccountStore } from '../infrastructure/admin/d1-admin-account-store.ts';
import { D1AdminAuthTokenStore } from '../infrastructure/admin/d1-admin-auth-token-store.ts';
import { D1AdminLoginChallengeStore } from '../infrastructure/admin/d1-admin-login-challenge-store.ts';
import { D1AdminRecoveryCodeStore } from '../infrastructure/admin/d1-admin-recovery-code-store.ts';
import { D1AdminSessionStore } from '../infrastructure/admin/d1-admin-session-store.ts';
import { D1AdminTotpCredentialStore } from '../infrastructure/admin/d1-admin-totp-credential-store.ts';
import { D1AuditLogStore } from '../infrastructure/admin/d1-audit-log-store.ts';
import { EmailAdminMailer } from '../infrastructure/admin/email-admin-mailer.ts';
import { GATEWAY_HEADERS } from '../presentation/gateway/gateway-headers.ts';
import { apiEnvSchema } from './env-schema.ts';
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
    [
      'AdminReAuthenticator',
      ADMIN_TYPES.AdminReAuthenticator,
      StoreAdminReAuthenticator,
    ],
    [
      'AdminMailSendLimits',
      ADMIN_TYPES.AdminMailSendLimits,
      CounterAdminMailSendLimits,
    ],
    [
      'AdminAuthTokenStore',
      ADMIN_TYPES.AdminAuthTokenStore,
      D1AdminAuthTokenStore,
    ],
    [
      'AdminLoginChallengeStore',
      ADMIN_TYPES.AdminLoginChallengeStore,
      D1AdminLoginChallengeStore,
    ],
    [
      'AdminTotpCredentialStore',
      ADMIN_TYPES.AdminTotpCredentialStore,
      D1AdminTotpCredentialStore,
    ],
    [
      'AdminRecoveryCodeStore',
      ADMIN_TYPES.AdminRecoveryCodeStore,
      D1AdminRecoveryCodeStore,
    ],
    ['AuditLogStore', ADMIN_TYPES.AuditLogStore, D1AuditLogStore],
    [
      'AuditLogRecorder',
      ADMIN_PLATFORM_TYPES.AuditLogRecorder,
      StoreAuditLogRecorder,
    ],
    ['AuditLogReader', ADMIN_TYPES.AuditLogReader, StoreAuditLogReader],
    ['AdminMailer', ADMIN_TYPES.AdminMailer, EmailAdminMailer],
    ['AdminLogin', ADMIN_TYPES.AdminLogin, StoreAdminLogin],
    ['AdminInvitation', ADMIN_TYPES.AdminInvitation, StoreAdminInvitation],
    [
      'AdminPasswordReset',
      ADMIN_TYPES.AdminPasswordReset,
      StoreAdminPasswordReset,
    ],
    ['AdminEmailChange', ADMIN_TYPES.AdminEmailChange, StoreAdminEmailChange],
    [
      'AdminPasswordChange',
      ADMIN_TYPES.AdminPasswordChange,
      StoreAdminPasswordChange,
    ],
    [
      'AdminTotpManagement',
      ADMIN_TYPES.AdminTotpManagement,
      StoreAdminTotpManagement,
    ],
    [
      'AdminAccountManagement',
      ADMIN_TYPES.AdminAccountManagement,
      StoreAdminAccountManagement,
    ],
    ['AdminProfile', ADMIN_TYPES.AdminProfile, StoreAdminProfile],
    [
      'AdminCredentialCleanupJob',
      ADMIN_TYPES.AdminCredentialCleanupJob,
      AdminCredentialCleanupJob,
    ],
    [
      'AuditLogRetentionJob',
      ADMIN_TYPES.AuditLogRetentionJob,
      AuditLogRetentionJob,
    ],
    ['AdminDirectory', ADMIN_PLATFORM_TYPES.AdminDirectory, D1AdminDirectory],
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

  test('監査ログの操作種別のカタログは、登録した全ての操作種別を登録順に持つ', () => {
    const catalog = createAdminTestContainer().get<AuditActionCatalog>(
      ADMIN_TYPES.AuditActionCatalog,
    );

    expect(catalog.list()).toEqual(AUDIT_ACTIONS);
    expect(catalog.find(ADMIN_ACCOUNT_DELETE_ACTION.name)).toEqual(
      ADMIN_ACCOUNT_DELETE_ACTION,
    );
  });

  test.each([
    {
      appEnvironment: 'local',
      adminOrigin: 'http://localhost:48045',
      totpIssuer: 'Launch Stadium Admin local',
    },
    {
      appEnvironment: 'staging',
      adminOrigin: 'https://genai-example-2-admin-staging.lab.kurachiweb.com',
      totpIssuer: 'Launch Stadium Admin staging',
    },
    {
      appEnvironment: 'prod',
      adminOrigin: 'https://genai-example-2-admin.lab.kurachiweb.com',
      totpIssuer: 'Launch Stadium Admin',
    },
  ] as const)(
    '管理者側のオリジンとTOTPの発行者名を環境($appEnvironment)から決める',
    ({ appEnvironment, adminOrigin, totpIssuer }) => {
      const settings = createAdminTestContainer({
        APP_ENVIRONMENT: appEnvironment,
        ADMIN_SITE_ORIGIN: adminOrigin,
      }).get<AdminSettings>(ADMIN_TYPES.AdminSettings);

      expect(settings).toEqual({ adminOrigin, totpIssuer });
    },
  );

  test('管理者の設定値は処理単位の中で同じインスタンスを返す', () => {
    const container = createAdminTestContainer();

    expect(container.get(ADMIN_TYPES.AdminSettings)).toBe(
      container.get(ADMIN_TYPES.AdminSettings),
    );
  });
});

describe('APIサーバーの管理者側のオリジンの環境の検証', () => {
  const invalidKeysOf = (input: Record<string, unknown>): readonly string[] => {
    const result = apiEnvSchema.safeParse(input);
    return result.success
      ? []
      : result.error.issues.map(({ path }) => String(path[0]));
  };

  test('ローカル環境の設定の管理者側のオリジンを受け付ける', () => {
    expect(invalidKeysOf({ ...env })).toEqual([]);
  });

  test.each([
    'https://genai-example-2-admin.lab.kurachiweb.com',
    'http://localhost:48045',
  ])('管理者側のオリジン%sを受け付ける', (origin) => {
    expect(invalidKeysOf({ ...env, ADMIN_SITE_ORIGIN: origin })).toEqual([]);
  });

  test.each([
    { label: '欠けている', value: undefined },
    { label: '空文字', value: '' },
    { label: '末尾にスラッシュがある', value: 'https://admin.example/' },
    { label: 'パスを持つ', value: 'https://admin.example/app' },
    { label: 'クエリを持つ', value: 'https://admin.example?x=1' },
    { label: 'http・https以外', value: 'ftp://admin.example' },
    { label: 'URLでない', value: 'admin.example' },
  ])('管理者側のオリジンが$labelなら拒否する', ({ value }) => {
    expect(invalidKeysOf({ ...env, ADMIN_SITE_ORIGIN: value })).toEqual([
      'ADMIN_SITE_ORIGIN',
    ]);
  });
});

describe('管理者のプロフィール画像のアップロードの用途', () => {
  const ADMIN_AVATAR_MAX_BYTES = 512_000;

  beforeEach(async () => {
    await clearMediaState();
  });

  function avatarUploadRequest(
    sessionToken: string,
    byteLength: number,
  ): Request {
    return new Request(
      `https://api.launch.example/internal/media/uploads/${ADMIN_AVATAR_UPLOAD_PURPOSE}`,
      {
        method: 'POST',
        headers: {
          [GATEWAY_HEADERS.clientIp]: '203.0.113.7',
          [GATEWAY_HEADERS.sessionToken]: sessionToken,
          [UPLOAD_FILE_NAME_HEADER]: 'avatar.png',
          'Content-Type': 'image/png',
          'Content-Length': String(byteLength),
        },
        body: pngBytes(16, 16, byteLength),
      },
    );
  }

  test('画像の5形式を512,000バイトまで管理者だけが画像の保存先へアップロードできる用途として登録する', () => {
    const purpose = createAdminTestContainer()
      .get<UploadPurposeRegistry>(MEDIA_TYPES.UploadPurposeRegistry)
      .find(ADMIN_AVATAR_UPLOAD_PURPOSE);

    expect(purpose).toEqual({
      name: 'admin-avatar',
      storage: 'images',
      uploaderKinds: ['admin'],
      allowedTypes: IMAGE_MEDIA_TYPES,
      maxBytes: ADMIN_AVATAR_MAX_BYTES,
    });
    expect(IMAGE_MEDIA_TYPES).toHaveLength(5);
  });

  test('管理者が512,001バイトの画像をアップロードすると、本文を読まずに413で拒否し記録を作らない', async () => {
    await insertAdmin(ADMIN);
    const issued = await issueAdminSession(adminIdOf(ADMIN));

    const response = await callInternal(
      'admin',
      avatarUploadRequest(issued.token, ADMIN_AVATAR_MAX_BYTES + 1),
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: { code: 'file_too_large' },
    });
    expect(await countRecords()).toBe(0);
  });

  test('管理者が上限以内の画像をアップロードすると、201で受け付ける', async () => {
    await insertAdmin(ADMIN);
    const issued = await issueAdminSession(adminIdOf(ADMIN));

    const response = await callInternal(
      'admin',
      avatarUploadRequest(issued.token, 1024),
    );

    expect(response.status).toBe(201);
    expect(await countRecords()).toBe(1);
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
