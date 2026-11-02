import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { createDatabase } from '../../../db/client.ts';
import { userAuthTokens } from '../../../db/schema/identity/user-auth-tokens.ts';
import { userSessions } from '../../../db/schema/identity/user-sessions.ts';
import { users } from '../../../db/schema/identity/users.ts';
import {
  after,
  clearIdentityTables,
  db,
  emailOf,
  insertUser,
  T0,
  userIdOf,
} from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import {
  createFailingD1,
  FAILING_D1_MESSAGE,
} from '../../../test/support/failing-d1.ts';
import type {
  NewAuthToken,
  NewSessionRecord,
  NewUserRecord,
  UserAccountStore,
} from '../../application/identity/ports.ts';
import type { AuthTokenPurpose } from '../../domain/identity/auth-token-purpose.ts';
import { D1UserAccountStore } from './d1-user-account-store.ts';

const DAY = 86_400_000;

const NEW_USER_INDEX = 10;

const ALL_PURPOSES: readonly AuthTokenPurpose[] = [
  'email_verification',
  'email_change',
  'password_reset',
  'password_change',
];

function createStore(): UserAccountStore {
  return new D1UserAccountStore(db);
}

function sessionIdOf(index: number): string {
  return `01JC0SESS${String(index).padStart(17, '0')}`;
}

function tokenIdOf(index: number): string {
  return `01JC0TOKN${String(index).padStart(17, '0')}`;
}

function hashOf(kind: string, index: number): string {
  return [kind, 'hash', String(index)].join('-');
}

function pseudonymousIdOf(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function newUserOf(
  index: number,
  overrides: Partial<NewUserRecord> = {},
): NewUserRecord {
  return {
    id: userIdOf(index),
    pseudonymousId: pseudonymousIdOf(index),
    email: emailOf(index),
    passwordHash: hashOf('password', index),
    nickname: `利用者${String(index)}`,
    handle: `newhandle${String(index)}`,
    termsAgreedAt: T0,
    ...overrides,
  };
}

function verificationTokenOf(index: number): NewAuthToken {
  return {
    userId: userIdOf(index),
    purpose: 'email_verification',
    tokenHash: hashOf('verification', index),
    expiresAt: after(DAY),
  };
}

function newSessionOf(userIndex: number, index: number): NewSessionRecord {
  return {
    id: sessionIdOf(index),
    userId: userIdOf(userIndex),
    tokenHash: hashOf('session', index),
    userAgent: 'Mozilla/5.0 (test)',
    createdAt: T0,
    lastUsedAt: T0,
    absoluteExpiresAt: after(90 * DAY),
  };
}

async function insertSession(userIndex: number, index: number): Promise<void> {
  await db.insert(userSessions).values({
    ...newSessionOf(userIndex, index),
    updatedAt: T0,
  });
}

async function insertToken(
  userIndex: number,
  index: number,
  purpose: AuthTokenPurpose,
): Promise<void> {
  await db.insert(userAuthTokens).values({
    id: tokenIdOf(index),
    userId: userIdOf(userIndex),
    purpose,
    tokenHash: hashOf('token', index),
    expiresAt: after(DAY),
    createdAt: T0,
    updatedAt: T0,
  });
}

// 4つの用途のトークンを1件ずつ作り、番号は利用者ごとに重ならないようにする
async function insertTokensOfAllPurposes(userIndex: number): Promise<void> {
  for (const [offset, purpose] of ALL_PURPOSES.entries()) {
    await insertToken(userIndex, userIndex * 10 + offset, purpose);
  }
}

async function readUser(index: number) {
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.id, userIdOf(index)));
  return row;
}

async function readSessionIdsOf(userIndex: number): Promise<string[]> {
  const rows = await db
    .select({ id: userSessions.id })
    .from(userSessions)
    .where(eq(userSessions.userId, userIdOf(userIndex)))
    .orderBy(asc(userSessions.id));
  return rows.map((row) => row.id);
}

async function readTokenPurposesOf(
  userIndex: number,
): Promise<AuthTokenPurpose[]> {
  const rows = await db
    .select({ purpose: userAuthTokens.purpose })
    .from(userAuthTokens)
    .where(eq(userAuthTokens.userId, userIdOf(userIndex)));
  return rows.map((row) => row.purpose).toSorted();
}

// 一括の書き込みの実行の失敗はD1のエラーがそのまま投げられ、文の組み立ての失敗はDrizzleQueryErrorに包まれるため、どちらも原因をたどって文言を集める
async function rejectionMessagesOf(
  pending: Promise<unknown>,
): Promise<string[]> {
  const reason: unknown = await pending.then(
    () => undefined,
    (error: unknown) => error,
  );
  const messages: string[] = [];
  for (
    let current = reason;
    current instanceof Error;
    current = current.cause
  ) {
    messages.push(current.message);
  }
  return messages;
}

function sortedPurposes(
  purposes: readonly AuthTokenPurpose[],
): AuthTokenPurpose[] {
  return [...purposes].toSorted();
}

beforeEach(async () => {
  await db.delete(userSessions);
  await db.delete(userAuthTokens);
  await clearIdentityTables();
});

describe('D1UserAccountStoreの読み取り', () => {
  describe('findById', () => {
    test('利用者の記録を状態・確認・判定・規約への同意・版とともに返す', async () => {
      await insertUser(1, {
        status: 'suspended',
        emailVerifiedAt: after(10),
        disposableEmailStatus: 'regular',
        termsAgreedAt: after(1),
        lifecycleVersion: 3,
      });

      expect(await createStore().findById(userIdOf(1))).toEqual({
        id: userIdOf(1),
        pseudonymousId: 'pseudonymous-1',
        email: emailOf(1),
        passwordHash: 'pbkdf2-sha256$test',
        nickname: '利用者1',
        handle: 'user1',
        status: 'suspended',
        emailVerifiedAt: after(10),
        disposableEmailStatus: 'regular',
        termsAgreedAt: after(1),
        lifecycleVersion: 3,
        deletedAt: null,
      });
    });

    test('退会済みの利用者も退会の日時とともに返す', async () => {
      await insertUser(1, { deletedAt: after(5) });

      expect(await createStore().findById(userIdOf(1))).toMatchObject({
        id: userIdOf(1),
        deletedAt: after(5),
      });
    });

    test('無い利用者はundefinedを返す', async () => {
      expect(await createStore().findById(userIdOf(1))).toBeUndefined();
    });
  });

  describe('findNotWithdrawnByEmail', () => {
    test('大文字小文字を区別せずにメールアドレスが一致する未退会の利用者を返す', async () => {
      await insertUser(1, { email: 'Someone@Mail.example' });

      expect(
        await createStore().findNotWithdrawnByEmail('someone@MAIL.EXAMPLE'),
      ).toMatchObject({ id: userIdOf(1), email: 'Someone@Mail.example' });
    });

    test('同じメールアドレスの退会済みの利用者がいても、未退会の利用者を返す', async () => {
      await insertUser(1, { email: emailOf(9), deletedAt: after(1) });
      await insertUser(2, { email: emailOf(9) });

      expect(
        await createStore().findNotWithdrawnByEmail(emailOf(9)),
      ).toMatchObject({ id: userIdOf(2) });
    });

    test('退会済みの利用者だけが一致する場合と、一致する利用者がいない場合はundefinedを返す', async () => {
      await insertUser(1, { deletedAt: after(1) });

      const store = createStore();

      expect(await store.findNotWithdrawnByEmail(emailOf(1))).toBeUndefined();
      expect(await store.findNotWithdrawnByEmail(emailOf(2))).toBeUndefined();
    });
  });

  describe('isEmailInUse', () => {
    test('大文字小文字を区別せずに未退会の利用者のメールアドレスと一致すれば真を返す', async () => {
      await insertUser(1, { email: 'Someone@Mail.example' });

      expect(await createStore().isEmailInUse('SOMEONE@mail.EXAMPLE')).toBe(
        true,
      );
    });

    test('退会済みの利用者だけが一致する場合と、一致する利用者がいない場合は偽を返す', async () => {
      await insertUser(1, { deletedAt: after(1) });

      const store = createStore();

      expect(await store.isEmailInUse(emailOf(1))).toBe(false);
      expect(await store.isEmailInUse(emailOf(2))).toBe(false);
    });

    test('除く利用者を指定すると、その利用者自身のメールアドレスとの一致を数えない', async () => {
      await insertUser(1);
      await insertUser(2, { email: 'Shared@mail.example' });

      const store = createStore();

      expect(await store.isEmailInUse(emailOf(1), userIdOf(1))).toBe(false);
      expect(await store.isEmailInUse('shared@mail.example', userIdOf(1))).toBe(
        true,
      );
    });
  });

  describe('listUndetermined', () => {
    test('判定が未判定で最後の判定が境界より前の確認済みの未退会の利用者を、判定の古い順に件数まで返す', async () => {
      const boundary = after(DAY);
      const undetermined = {
        disposableEmailStatus: 'undetermined',
        emailVerifiedAt: T0,
      } as const;
      await insertUser(1, {
        ...undetermined,
        disposableEmailCheckedAt: after(30),
      });
      await insertUser(2, {
        ...undetermined,
        disposableEmailCheckedAt: after(10),
      });
      await insertUser(3, {
        ...undetermined,
        disposableEmailCheckedAt: after(20),
      });
      await insertUser(4, {
        ...undetermined,
        disposableEmailCheckedAt: boundary,
      });
      await insertUser(5, {
        ...undetermined,
        disposableEmailStatus: 'regular',
        disposableEmailCheckedAt: after(1),
      });
      await insertUser(6, {
        ...undetermined,
        emailVerifiedAt: null,
        disposableEmailCheckedAt: after(1),
      });
      await insertUser(7, {
        ...undetermined,
        deletedAt: after(2),
        disposableEmailCheckedAt: after(1),
      });

      const store = createStore();

      expect(await store.listUndetermined(boundary, 10)).toEqual([
        userIdOf(2),
        userIdOf(3),
        userIdOf(1),
      ]);
      expect(await store.listUndetermined(boundary, 2)).toEqual([
        userIdOf(2),
        userIdOf(3),
      ]);
    });
  });
});

describe('D1UserAccountStoreのcreateWithVerification', () => {
  test('利用者・確認のトークン・セッションを作り、未確認・有効・判定なし・版0の利用者にする', async () => {
    const result = await createStore().createWithVerification(
      newUserOf(NEW_USER_INDEX),
      verificationTokenOf(NEW_USER_INDEX),
      newSessionOf(NEW_USER_INDEX, 1),
    );

    expect(result).toBe('created');
    expect(await readUser(NEW_USER_INDEX)).toMatchObject({
      id: userIdOf(NEW_USER_INDEX),
      pseudonymousId: pseudonymousIdOf(NEW_USER_INDEX),
      email: emailOf(NEW_USER_INDEX),
      passwordHash: hashOf('password', NEW_USER_INDEX),
      nickname: `利用者${String(NEW_USER_INDEX)}`,
      handle: `newhandle${String(NEW_USER_INDEX)}`,
      status: 'active',
      suspendedAt: null,
      emailVerifiedAt: null,
      disposableEmailStatus: null,
      disposableEmailCheckedAt: null,
      termsAgreedAt: T0,
      lifecycleVersion: 0,
      createdAt: T0,
      updatedAt: T0,
      deletedAt: null,
    });
    const [token] = await db
      .select()
      .from(userAuthTokens)
      .where(eq(userAuthTokens.userId, userIdOf(NEW_USER_INDEX)));
    expect(token).toMatchObject({
      purpose: 'email_verification',
      tokenHash: hashOf('verification', NEW_USER_INDEX),
      expiresAt: after(DAY),
      newEmail: null,
      pendingPasswordHash: null,
      createdAt: T0,
    });
    const [session] = await db
      .select()
      .from(userSessions)
      .where(eq(userSessions.userId, userIdOf(NEW_USER_INDEX)));
    expect(session).toEqual({
      ...newSessionOf(NEW_USER_INDEX, 1),
      updatedAt: T0,
    });
  });

  test('大文字小文字だけが違う未退会の利用者のメールアドレスと重なれば、何も作らずemail-in-useを返す', async () => {
    await insertUser(1, { email: 'Taken@Mail.example' });

    const result = await createStore().createWithVerification(
      newUserOf(NEW_USER_INDEX, { email: 'taken@mail.EXAMPLE' }),
      verificationTokenOf(NEW_USER_INDEX),
      newSessionOf(NEW_USER_INDEX, 1),
    );

    expect(result).toBe('email-in-use');
    expect(await readUser(NEW_USER_INDEX)).toBeUndefined();
    expect(await readTokenPurposesOf(NEW_USER_INDEX)).toEqual([]);
    expect(await readSessionIdsOf(NEW_USER_INDEX)).toEqual([]);
  });

  test('退会済みの利用者と同じメールアドレスなら、退会の直後でも作る', async () => {
    await insertUser(1, { deletedAt: T0 });

    const result = await createStore().createWithVerification(
      newUserOf(NEW_USER_INDEX, { email: emailOf(1) }),
      verificationTokenOf(NEW_USER_INDEX),
      newSessionOf(NEW_USER_INDEX, 1),
    );

    expect(result).toBe('created');
    expect(await readUser(NEW_USER_INDEX)).toMatchObject({ email: emailOf(1) });
  });

  test.each([
    { label: '未退会', deletedAt: null },
    { label: '退会後に物理削除されていない', deletedAt: T0 },
  ])(
    '大文字小文字だけが違う$labelの利用者のハンドルと重なれば、何も作らずhandle-in-useを返す',
    async ({ deletedAt }) => {
      await insertUser(1, { handle: 'TakenHandle', deletedAt });

      const result = await createStore().createWithVerification(
        newUserOf(NEW_USER_INDEX, { handle: 'takenhandle' }),
        verificationTokenOf(NEW_USER_INDEX),
        newSessionOf(NEW_USER_INDEX, 1),
      );

      expect(result).toBe('handle-in-use');
      expect(await readUser(NEW_USER_INDEX)).toBeUndefined();
      expect(await readTokenPurposesOf(NEW_USER_INDEX)).toEqual([]);
      expect(await readSessionIdsOf(NEW_USER_INDEX)).toEqual([]);
    },
  );

  test('メールアドレスとハンドル以外の一意制約の違反は結果に変えずに投げ、利用者もトークンも作らない', async () => {
    await insertUser(1);
    await insertSession(1, 1);

    const messages = await rejectionMessagesOf(
      createStore().createWithVerification(
        newUserOf(NEW_USER_INDEX),
        verificationTokenOf(NEW_USER_INDEX),
        { ...newSessionOf(NEW_USER_INDEX, 2), tokenHash: hashOf('session', 1) },
      ),
    );

    expect(messages).toContainEqual(
      expect.stringContaining(
        'UNIQUE constraint failed: user_sessions.token_hash',
      ),
    );

    expect(await readUser(NEW_USER_INDEX)).toBeUndefined();
    expect(await readTokenPurposesOf(NEW_USER_INDEX)).toEqual([]);
  });

  test('データベースの障害は結果に変えずに投げる', async () => {
    const store = new D1UserAccountStore(createDatabase(createFailingD1()));

    const messages = await rejectionMessagesOf(
      store.createWithVerification(
        newUserOf(NEW_USER_INDEX),
        verificationTokenOf(NEW_USER_INDEX),
        newSessionOf(NEW_USER_INDEX, 1),
      ),
    );

    expect(messages).toContain(FAILING_D1_MESSAGE);
  });
});

describe('D1UserAccountStoreの確認と判定の更新', () => {
  test('markEmailVerifiedは未確認の利用者を指定の日時で確認済みにし、他の利用者を変えない', async () => {
    await insertUser(1);
    await insertUser(2);

    await createStore().markEmailVerified(userIdOf(1), after(10));

    expect(await readUser(1)).toMatchObject({
      emailVerifiedAt: after(10),
      updatedAt: after(10),
    });
    expect(await readUser(2)).toMatchObject({ emailVerifiedAt: null });
  });

  test('saveDisposableStatusは判定の結果と判定の日時を保存する', async () => {
    await insertUser(1, {
      disposableEmailStatus: 'undetermined',
      disposableEmailCheckedAt: T0,
    });

    await createStore().saveDisposableStatus(userIdOf(1), 'regular', after(20));

    expect(await readUser(1)).toMatchObject({
      disposableEmailStatus: 'regular',
      disposableEmailCheckedAt: after(20),
      updatedAt: after(20),
    });
  });
});

describe('D1UserAccountStoreのパスワードリセット・メールアドレス変更・パスワード変更の確定', () => {
  beforeEach(async () => {
    await insertUser(1);
    await insertUser(2);
    await insertSession(1, 1);
    await insertSession(1, 2);
    await insertSession(2, 3);
    await insertTokensOfAllPurposes(1);
    await insertTokensOfAllPurposes(2);
  });

  describe('applyPasswordReset', () => {
    test('パスワードを更新して未確認の利用者を確認済みにし、全セッションとリセット・変更のトークンを削除する', async () => {
      await createStore().applyPasswordReset(
        userIdOf(1),
        hashOf('reset', 1),
        after(50),
      );

      expect(await readUser(1)).toMatchObject({
        passwordHash: hashOf('reset', 1),
        emailVerifiedAt: after(50),
        updatedAt: after(50),
      });
      expect(await readSessionIdsOf(1)).toEqual([]);
      expect(await readTokenPurposesOf(1)).toEqual(
        sortedPurposes(['email_verification', 'email_change']),
      );
    });

    test('確認済みの利用者は確認の日時を変えない', async () => {
      await db
        .update(users)
        .set({ emailVerifiedAt: after(5) })
        .where(eq(users.id, userIdOf(1)));

      await createStore().applyPasswordReset(
        userIdOf(1),
        hashOf('reset', 1),
        after(50),
      );

      expect(await readUser(1)).toMatchObject({ emailVerifiedAt: after(5) });
    });

    test('他の利用者の記録・セッション・トークンを変えない', async () => {
      await createStore().applyPasswordReset(
        userIdOf(1),
        hashOf('reset', 1),
        after(50),
      );

      expect(await readUser(2)).toMatchObject({
        passwordHash: 'pbkdf2-sha256$test',
        emailVerifiedAt: null,
      });
      expect(await readSessionIdsOf(2)).toEqual([sessionIdOf(3)]);
      expect(await readTokenPurposesOf(2)).toEqual(
        sortedPurposes(ALL_PURPOSES),
      );
    });
  });

  describe('applyEmailChange', () => {
    test('メールアドレスを更新して確認済みにし、判定を消して、全セッションと確認・変更のトークンを削除する', async () => {
      await db
        .update(users)
        .set({
          disposableEmailStatus: 'disposable',
          disposableEmailCheckedAt: after(1),
        })
        .where(eq(users.id, userIdOf(1)));

      const result = await createStore().applyEmailChange(
        userIdOf(1),
        'Changed@Mail.example',
        after(60),
      );

      expect(result).toBe('changed');
      expect(await readUser(1)).toMatchObject({
        email: 'Changed@Mail.example',
        emailVerifiedAt: after(60),
        disposableEmailStatus: null,
        disposableEmailCheckedAt: null,
        updatedAt: after(60),
      });
      expect(await readSessionIdsOf(1)).toEqual([]);
      expect(await readTokenPurposesOf(1)).toEqual(
        sortedPurposes(['password_reset', 'password_change']),
      );
      expect(await readSessionIdsOf(2)).toEqual([sessionIdOf(3)]);
      expect(await readTokenPurposesOf(2)).toEqual(
        sortedPurposes(ALL_PURPOSES),
      );
    });

    test('自分の現在のメールアドレスと大文字小文字だけが違う変更先も受け付ける', async () => {
      const result = await createStore().applyEmailChange(
        userIdOf(1),
        emailOf(1).toUpperCase(),
        after(60),
      );

      expect(result).toBe('changed');
      expect(await readUser(1)).toMatchObject({
        email: emailOf(1).toUpperCase(),
      });
    });

    test('変更先が大文字小文字を区別せずに他の未退会の利用者と重なれば、何も変えずemail-in-useを返す', async () => {
      const result = await createStore().applyEmailChange(
        userIdOf(1),
        emailOf(2).toUpperCase(),
        after(60),
      );

      expect(result).toBe('email-in-use');
      expect(await readUser(1)).toMatchObject({
        email: emailOf(1),
        emailVerifiedAt: null,
        updatedAt: T0,
      });
      expect(await readSessionIdsOf(1)).toEqual([
        sessionIdOf(1),
        sessionIdOf(2),
      ]);
      expect(await readTokenPurposesOf(1)).toEqual(
        sortedPurposes(ALL_PURPOSES),
      );
    });

    test('変更先が退会済みの利用者のメールアドレスなら変更する', async () => {
      await insertUser(3, { deletedAt: T0 });

      const result = await createStore().applyEmailChange(
        userIdOf(1),
        emailOf(3),
        after(60),
      );

      expect(result).toBe('changed');
      expect(await readUser(1)).toMatchObject({ email: emailOf(3) });
    });

    test('データベースの障害は結果に変えずに投げる', async () => {
      const store = new D1UserAccountStore(createDatabase(createFailingD1()));

      const messages = await rejectionMessagesOf(
        store.applyEmailChange(userIdOf(1), emailOf(9), after(60)),
      );

      expect(messages).toContain(FAILING_D1_MESSAGE);
    });
  });

  describe('applyPasswordChange', () => {
    test('パスワードを更新し、全セッションと変更のトークンだけを削除して、確認の状態を変えない', async () => {
      await createStore().applyPasswordChange(userIdOf(1), hashOf('change', 1));

      expect(await readUser(1)).toMatchObject({
        passwordHash: hashOf('change', 1),
        emailVerifiedAt: null,
      });
      expect(await readSessionIdsOf(1)).toEqual([]);
      expect(await readTokenPurposesOf(1)).toEqual(
        sortedPurposes([
          'email_verification',
          'email_change',
          'password_reset',
        ]),
      );
      expect(await readSessionIdsOf(2)).toEqual([sessionIdOf(3)]);
      expect(await readTokenPurposesOf(2)).toEqual(
        sortedPurposes(ALL_PURPOSES),
      );
    });
  });
});
