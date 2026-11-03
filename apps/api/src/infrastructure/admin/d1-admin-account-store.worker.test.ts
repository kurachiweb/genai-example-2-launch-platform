import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { ADMIN_ACCOUNT_INVITE_ACTION } from '../../../common-lib/admin/audit-actions/admin-foundation.ts';
import { adminAuthTokens } from '../../../db/schema/admin/admin-auth-tokens.ts';
import { adminRecoveryCodes } from '../../../db/schema/admin/admin-recovery-codes.ts';
import { adminSessions } from '../../../db/schema/admin/admin-sessions.ts';
import { adminTotpCredentials } from '../../../db/schema/admin/admin-totp-credentials.ts';
import { admins } from '../../../db/schema/admin/admins.ts';
import type { PreparedAuditEntry } from '../../application/admin/audit-log-recorder.ts';
import type { NewAdminSessionRecord } from '../../application/admin/ports.ts';
import { D1AdminAccountStore } from './d1-admin-account-store.ts';
import {
  adminEmailOf,
  adminIdOf,
  after,
  auditLogIdOf,
  clearAdminTables,
  createAuditLogRecorder,
  db,
  HOUR_MS,
  insertAdmin,
  insertAdminSession,
  insertAdminToken,
  insertInvitedAdmin,
  readAdminRow,
  readAuditLogSummaries,
  readAuditLogTargetIds,
  T0,
} from './testing/admin-store-fixtures.ts';

const AT = after(60_000);

const OPERATOR = 1;

const TARGET = 2;

const OTHER = 3;

const NEW_ADMIN = 9;

const SESSION_ID = '01JC0SESN00000000000000001';

const RECOVERY_HASHES = Array.from(
  { length: 10 },
  (_, index) => `recovery-hash-${String(index).padStart(2, '0')}`,
);

const store = new D1AdminAccountStore(db);

function prepareInvite(targetIndex: number): PreparedAuditEntry {
  return createAuditLogRecorder({
    ids: { generate: () => auditLogIdOf(1) },
  }).prepare({
    operatorAdminId: adminIdOf(OPERATOR),
    action: ADMIN_ACCOUNT_INVITE_ACTION.name,
    targetIds: [adminIdOf(targetIndex)],
    occurredAt: AT,
  });
}

function sessionOf(adminIndex: number): NewAdminSessionRecord {
  return {
    id: SESSION_ID,
    adminId: adminIdOf(adminIndex),
    tokenHash: 'session-hash',
    userAgent: 'Mozilla/5.0',
    createdAt: AT,
    lastUsedAt: AT,
    absoluteExpiresAt: new Date(AT.getTime() + 12 * HOUR_MS),
  };
}

async function readTokens(adminIndex: number) {
  return db
    .select({
      purpose: adminAuthTokens.purpose,
      tokenHash: adminAuthTokens.tokenHash,
      expiresAt: adminAuthTokens.expiresAt,
    })
    .from(adminAuthTokens)
    .where(eq(adminAuthTokens.adminId, adminIdOf(adminIndex)))
    .orderBy(asc(adminAuthTokens.tokenHash));
}

async function readSessionHashes(adminIndex: number): Promise<string[]> {
  const rows = await db
    .select({ tokenHash: adminSessions.tokenHash })
    .from(adminSessions)
    .where(eq(adminSessions.adminId, adminIdOf(adminIndex)))
    .orderBy(asc(adminSessions.tokenHash));
  return rows.map((row) => row.tokenHash);
}

async function readTotp(adminIndex: number) {
  return db
    .select({
      sealedSecret: adminTotpCredentials.sealedSecret,
      enabledAt: adminTotpCredentials.enabledAt,
      lastUsedStep: adminTotpCredentials.lastUsedStep,
      pendingSealedSecret: adminTotpCredentials.pendingSealedSecret,
      pendingExpiresAt: adminTotpCredentials.pendingExpiresAt,
    })
    .from(adminTotpCredentials)
    .where(eq(adminTotpCredentials.adminId, adminIdOf(adminIndex)));
}

beforeEach(async () => {
  await clearAdminTables();
});

describe('D1AdminAccountStoreの照会', () => {
  test('findByIdは保存した項目を管理者の記録として返し、無いIDではundefinedを返す', async () => {
    await insertAdmin(OPERATOR, {
      role: 'moderator',
      title: '運営チーム',
      avatarFileId: 'file-1',
    });

    expect(await store.findById(adminIdOf(OPERATOR))).toEqual({
      id: adminIdOf(OPERATOR),
      role: 'moderator',
      status: 'active',
      invitationExpiresAt: null,
      email: adminEmailOf(OPERATOR),
      passwordHash: 'pbkdf2-sha256$test',
      nickname: '管理者1',
      title: '運営チーム',
      avatarFileId: 'file-1',
      createdAt: T0,
      activatedAt: T0,
    });
    expect(await store.findById(adminIdOf(TARGET))).toBeUndefined();
  });

  test('findByEmailは大文字小文字を区別せずに探す', async () => {
    await insertAdmin(OPERATOR);

    const found = await store.findByEmail(adminEmailOf(OPERATOR).toUpperCase());

    expect(found?.id).toBe(adminIdOf(OPERATOR));
    expect(await store.findByEmail('nobody@mail.example')).toBeUndefined();
  });

  test('listは招待中を含む全管理者を登録の新しい順に返す', async () => {
    await insertAdmin(OPERATOR, { createdAt: T0 });
    await insertAdmin(TARGET, { createdAt: after(2_000) });
    await insertInvitedAdmin(OTHER, { createdAt: after(1_000) });

    const listed = await store.list();

    expect(listed.map((admin) => admin.id)).toEqual([
      adminIdOf(TARGET),
      adminIdOf(OTHER),
      adminIdOf(OPERATOR),
    ]);
  });

  test('findProfilesは101件のIDを分けて照会し、存在する管理者だけをIDごとに返す', async () => {
    const indexes = Array.from({ length: 101 }, (_, index) => index + 1);
    for (const index of indexes) {
      await insertAdmin(index);
    }

    const profiles = await store.findProfiles([
      ...indexes.map((index) => adminIdOf(index)),
      adminIdOf(1),
      adminIdOf(500),
    ]);

    expect(profiles.size).toBe(101);
    expect(profiles.get(adminIdOf(101))?.nickname).toBe('管理者101');
    expect(profiles.has(adminIdOf(500))).toBe(false);
  });

  test('findProfilesは空の入力で空のMapを返す', async () => {
    expect((await store.findProfiles([])).size).toBe(0);
  });
});

describe('D1AdminAccountStore.insertInvited', () => {
  test('閲覧のみの招待中の管理者・招待のトークン・監査ログをそろって保存する', async () => {
    await insertAdmin(OPERATOR, { role: 'moderator' });
    const expiresAt = after(24 * HOUR_MS);

    const result = await store.insertInvited(
      { id: adminIdOf(NEW_ADMIN), email: 'new@mail.example', invitedAt: AT },
      { tokenHash: 'invitation-hash', expiresAt },
      prepareInvite(NEW_ADMIN),
    );

    expect(result).toBe('created');
    expect(await readAdminRow(NEW_ADMIN)).toMatchObject({
      email: 'new@mail.example',
      role: 'viewer',
      status: 'invited',
      passwordHash: null,
      nickname: null,
      invitationExpiresAt: expiresAt,
      activatedAt: null,
      createdAt: AT,
    });
    expect(await readTokens(NEW_ADMIN)).toEqual([
      { purpose: 'invitation', tokenHash: 'invitation-hash', expiresAt },
    ]);
    expect(await readAuditLogSummaries()).toEqual([
      {
        id: auditLogIdOf(1),
        operatorAdminId: adminIdOf(OPERATOR),
        action: ADMIN_ACCOUNT_INVITE_ACTION.name,
        detail: {},
      },
    ]);
    expect(await readAuditLogTargetIds()).toEqual([adminIdOf(NEW_ADMIN)]);
  });

  test('大文字小文字だけが異なるメールアドレスの管理者がいれば、何も保存せずにemail-in-useを返す', async () => {
    await insertAdmin(OPERATOR, { role: 'moderator' });

    const result = await store.insertInvited(
      {
        id: adminIdOf(NEW_ADMIN),
        email: adminEmailOf(OPERATOR).toUpperCase(),
        invitedAt: AT,
      },
      { tokenHash: 'invitation-hash', expiresAt: after(24 * HOUR_MS) },
      prepareInvite(NEW_ADMIN),
    );

    expect(result).toBe('email-in-use');
    expect(await readAdminRow(NEW_ADMIN)).toBeUndefined();
    expect(await db.$count(adminAuthTokens)).toBe(0);
    expect(await readAuditLogSummaries()).toEqual([]);
    expect(await readAuditLogTargetIds()).toEqual([]);
  });

  test('一意制約以外の失敗はそのまま投げる', async () => {
    await insertAdmin(OPERATOR, { role: 'moderator' });
    await insertAdminToken(OPERATOR, 'password_reset', 'duplicated-hash');

    await expect(
      store.insertInvited(
        { id: adminIdOf(NEW_ADMIN), email: 'new@mail.example', invitedAt: AT },
        { tokenHash: 'duplicated-hash', expiresAt: after(24 * HOUR_MS) },
        prepareInvite(NEW_ADMIN),
      ),
    ).rejects.toThrow();
    expect(await readAdminRow(NEW_ADMIN)).toBeUndefined();
  });
});

describe('D1AdminAccountStore.reissueInvitation', () => {
  test('未使用の招待のトークンを新しいトークンに置き換え、招待の期限を更新し、監査ログを記録する', async () => {
    await insertAdmin(OPERATOR, { role: 'moderator' });
    await insertInvitedAdmin(TARGET);
    await insertAdminToken(TARGET, 'invitation', 'old-invitation-1');
    await insertAdminToken(TARGET, 'invitation', 'old-invitation-2');
    const expiresAt = after(48 * HOUR_MS);

    const result = await store.reissueInvitation(
      adminIdOf(TARGET),
      { tokenHash: 'new-invitation', expiresAt },
      prepareInvite(TARGET),
    );

    expect(result).toBe('reissued');
    expect(await readTokens(TARGET)).toEqual([
      { purpose: 'invitation', tokenHash: 'new-invitation', expiresAt },
    ]);
    expect((await readAdminRow(TARGET))?.invitationExpiresAt).toEqual(
      expiresAt,
    );
    expect((await readAuditLogSummaries()).map((log) => log.id)).toEqual([
      auditLogIdOf(1),
    ]);
    expect(await readAuditLogTargetIds()).toEqual([adminIdOf(TARGET)]);
  });

  test.each([
    { name: '有効な管理者', setup: () => insertAdmin(TARGET) },
    { name: '存在しない管理者', setup: () => Promise.resolve() },
  ])('$nameには何も保存せずにnot-invitedを返す', async ({ setup }) => {
    await insertAdmin(OPERATOR, { role: 'moderator' });
    await setup();
    const before = await readAdminRow(TARGET);

    const result = await store.reissueInvitation(
      adminIdOf(TARGET),
      { tokenHash: 'new-invitation', expiresAt: after(48 * HOUR_MS) },
      prepareInvite(TARGET),
    );

    expect(result).toBe('not-invited');
    expect(await readAdminRow(TARGET)).toEqual(before);
    expect(await db.$count(adminAuthTokens)).toBe(0);
    expect(await readAuditLogSummaries()).toEqual([]);
    expect(await readAuditLogTargetIds()).toEqual([]);
  });

  test('条件の判定以外の失敗はそのまま投げる', async () => {
    await insertAdmin(OPERATOR, { role: 'moderator' });
    await insertInvitedAdmin(TARGET);
    await insertAdminToken(OPERATOR, 'password_reset', 'duplicated-hash');

    await expect(
      store.reissueInvitation(
        adminIdOf(TARGET),
        { tokenHash: 'duplicated-hash', expiresAt: after(48 * HOUR_MS) },
        prepareInvite(TARGET),
      ),
    ).rejects.toThrow();
  });
});

describe('D1AdminAccountStore.savePendingProfile', () => {
  test('招待中の管理者にニックネームとパスワードのハッシュを仮に保存し、状態は変えない', async () => {
    await insertInvitedAdmin(TARGET);

    await store.savePendingProfile(adminIdOf(TARGET), {
      nickname: '新しい管理者',
      passwordHash: 'pbkdf2-sha512$pending',
    });

    expect(await readAdminRow(TARGET)).toMatchObject({
      nickname: '新しい管理者',
      passwordHash: 'pbkdf2-sha512$pending',
      status: 'invited',
      activatedAt: null,
    });
  });

  test('有効な管理者のニックネームとパスワードは書き換えない', async () => {
    await insertAdmin(TARGET);

    await store.savePendingProfile(adminIdOf(TARGET), {
      nickname: '書き換え',
      passwordHash: 'pbkdf2-sha512$other',
    });

    expect(await readAdminRow(TARGET)).toMatchObject({
      nickname: '管理者2',
      passwordHash: 'pbkdf2-sha256$test',
    });
  });
});

describe('D1AdminAccountStore.activate', () => {
  async function prepareInvitation(): Promise<void> {
    await insertInvitedAdmin(TARGET);
    await store.savePendingProfile(adminIdOf(TARGET), {
      nickname: '新しい管理者',
      passwordHash: 'pbkdf2-sha512$pending',
    });
    await insertAdminToken(TARGET, 'invitation', 'invitation-1');
    await insertAdminToken(TARGET, 'invitation', 'invitation-2');
    await db.insert(adminTotpCredentials).values({
      adminId: adminIdOf(TARGET),
      pendingSealedSecret: 'sealed-pending',
      pendingExpiresAt: after(10 * 60_000),
      createdAt: T0,
      updatedAt: T0,
    });
  }

  function activate() {
    return store.activate(adminIdOf(TARGET), {
      at: AT,
      step: 12_345,
      pendingSealedSecret: 'sealed-pending',
      recoveryHashes: RECOVERY_HASHES,
      session: sessionOf(TARGET),
    });
  }

  test('有効化・TOTPの確定・リカバリコード・セッションの追加と、残りの招待のトークンの削除をそろって行う', async () => {
    await prepareInvitation();

    const result = await activate();

    expect(result).toBe('activated');
    expect(await readAdminRow(TARGET)).toMatchObject({
      status: 'active',
      activatedAt: AT,
      invitationExpiresAt: null,
      nickname: '新しい管理者',
      passwordHash: 'pbkdf2-sha512$pending',
    });
    expect(await readTotp(TARGET)).toEqual([
      {
        sealedSecret: 'sealed-pending',
        enabledAt: AT,
        lastUsedStep: 12_345,
        pendingSealedSecret: null,
        pendingExpiresAt: null,
      },
    ]);
    const codes = await db
      .select({ codeHash: adminRecoveryCodes.codeHash })
      .from(adminRecoveryCodes)
      .where(eq(adminRecoveryCodes.adminId, adminIdOf(TARGET)))
      .orderBy(asc(adminRecoveryCodes.codeHash));
    expect(codes.map((code) => code.codeHash)).toEqual(RECOVERY_HASHES);
    expect(
      await db
        .select({
          id: adminSessions.id,
          tokenHash: adminSessions.tokenHash,
          userAgent: adminSessions.userAgent,
          lastUsedAt: adminSessions.lastUsedAt,
          absoluteExpiresAt: adminSessions.absoluteExpiresAt,
        })
        .from(adminSessions)
        .where(eq(adminSessions.adminId, adminIdOf(TARGET))),
    ).toEqual([
      {
        id: SESSION_ID,
        tokenHash: 'session-hash',
        userAgent: 'Mozilla/5.0',
        lastUsedAt: AT,
        absoluteExpiresAt: new Date(AT.getTime() + 12 * HOUR_MS),
      },
    ]);
    expect(await readTokens(TARGET)).toEqual([]);
  });

  test.each([
    {
      name: '既に有効な管理者',
      change: () =>
        db
          .update(admins)
          .set({ status: 'active', activatedAt: T0 })
          .where(eq(admins.id, adminIdOf(TARGET))),
    },
    {
      name: '照合の後に設定が始め直され、保留の秘密鍵が入れ替わった管理者',
      change: () =>
        db
          .update(adminTotpCredentials)
          .set({ pendingSealedSecret: 'sealed-restarted' })
          .where(eq(adminTotpCredentials.adminId, adminIdOf(TARGET))),
    },
    {
      name: 'パスワードを仮に保存する前の管理者',
      change: () =>
        db
          .update(admins)
          .set({ passwordHash: null })
          .where(eq(admins.id, adminIdOf(TARGET))),
    },
    {
      name: 'ニックネームを仮に保存する前の管理者',
      change: () =>
        db
          .update(admins)
          .set({ nickname: null })
          .where(eq(admins.id, adminIdOf(TARGET))),
    },
    {
      name: '保留の期限ちょうどの管理者',
      change: () =>
        db
          .update(adminTotpCredentials)
          .set({ pendingExpiresAt: AT })
          .where(eq(adminTotpCredentials.adminId, adminIdOf(TARGET))),
    },
  ])('$nameは何も変えずにnot-invitedを返す', async ({ change }) => {
    await prepareInvitation();
    await change();
    const before = {
      admin: await readAdminRow(TARGET),
      tokens: await readTokens(TARGET),
      totp: await readTotp(TARGET),
    };

    const result = await activate();

    expect(result).toBe('not-invited');
    expect({
      admin: await readAdminRow(TARGET),
      tokens: await readTokens(TARGET),
      totp: await readTotp(TARGET),
    }).toEqual(before);
    expect(await db.$count(adminSessions)).toBe(0);
    expect(await db.$count(adminRecoveryCodes)).toBe(0);
  });

  test('存在しない管理者には何も追加せずにnot-invitedを返す', async () => {
    expect(await activate()).toBe('not-invited');
    expect(await db.$count(adminSessions)).toBe(0);
    expect(await db.$count(adminRecoveryCodes)).toBe(0);
  });

  test('条件の判定以外の失敗はそのまま投げる', async () => {
    await prepareInvitation();
    await insertAdmin(OTHER);
    await insertAdminSession(OTHER, 'session-hash');

    await expect(activate()).rejects.toThrow();
    expect((await readAdminRow(TARGET))?.status).toBe('invited');
  });
});

describe('D1AdminAccountStore.updateProfile', () => {
  test('ニックネーム・肩書き・プロフィール画像を書き換える', async () => {
    await insertAdmin(TARGET, { title: '旧肩書き', avatarFileId: 'old-file' });

    await store.updateProfile(adminIdOf(TARGET), {
      nickname: '新しい名前',
      title: null,
      avatarFileId: 'new-file',
    });

    expect(await readAdminRow(TARGET)).toMatchObject({
      nickname: '新しい名前',
      title: null,
      avatarFileId: 'new-file',
    });
  });
});

describe('D1AdminAccountStoreの資格情報の更新', () => {
  async function prepareCredentials(): Promise<void> {
    await insertAdmin(TARGET);
    await insertAdmin(OTHER);
    await insertAdminSession(TARGET, 'target-session-1');
    await insertAdminSession(TARGET, 'target-session-2');
    await insertAdminSession(OTHER, 'other-session');
    await insertAdminToken(TARGET, 'password_reset', 'target-reset');
    await insertAdminToken(TARGET, 'email_change', 'target-email-change');
    await insertAdminToken(OTHER, 'password_reset', 'other-reset');
  }

  test('applyPasswordResetは、パスワードを更新し、全セッションと未使用のリセットのトークンを消す', async () => {
    await prepareCredentials();

    await store.applyPasswordReset(adminIdOf(TARGET), 'pbkdf2-sha512$reset');

    expect((await readAdminRow(TARGET))?.passwordHash).toBe(
      'pbkdf2-sha512$reset',
    );
    expect(await readSessionHashes(TARGET)).toEqual([]);
    expect((await readTokens(TARGET)).map((token) => token.purpose)).toEqual([
      'email_change',
    ]);
    expect(await readSessionHashes(OTHER)).toEqual(['other-session']);
    expect(await readTokens(OTHER)).toHaveLength(1);
  });

  test('applyEmailChangeは、メールアドレスを更新し、全セッションと未使用の変更のトークンを消す', async () => {
    await prepareCredentials();

    const result = await store.applyEmailChange(
      adminIdOf(TARGET),
      'changed@mail.example',
    );

    expect(result).toBe('changed');
    expect((await readAdminRow(TARGET))?.email).toBe('changed@mail.example');
    expect(await readSessionHashes(TARGET)).toEqual([]);
    expect((await readTokens(TARGET)).map((token) => token.purpose)).toEqual([
      'password_reset',
    ]);
    expect(await readSessionHashes(OTHER)).toEqual(['other-session']);
  });

  test('applyEmailChangeは、大文字小文字だけが異なるメールアドレスの他の管理者がいれば、何も変えずにemail-in-useを返す', async () => {
    await prepareCredentials();

    const result = await store.applyEmailChange(
      adminIdOf(TARGET),
      adminEmailOf(OTHER).toUpperCase(),
    );

    expect(result).toBe('email-in-use');
    expect((await readAdminRow(TARGET))?.email).toBe(adminEmailOf(TARGET));
    expect(await readSessionHashes(TARGET)).toEqual([
      'target-session-1',
      'target-session-2',
    ]);
    expect(await readTokens(TARGET)).toHaveLength(2);
  });

  test('applyPasswordChangeは、パスワードを更新し、全セッションを消す', async () => {
    await prepareCredentials();

    await store.applyPasswordChange(adminIdOf(TARGET), 'pbkdf2-sha512$changed');

    expect((await readAdminRow(TARGET))?.passwordHash).toBe(
      'pbkdf2-sha512$changed',
    );
    expect(await readSessionHashes(TARGET)).toEqual([]);
    expect(await readTokens(TARGET)).toHaveLength(2);
    expect(await readSessionHashes(OTHER)).toEqual(['other-session']);
  });
});
