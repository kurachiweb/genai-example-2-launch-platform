import { describe, expect, test } from 'bun:test';
import { Container } from 'inversify';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import type {
  AccountGuard,
  CurrentUser,
  UserAccountView,
} from '../../../lib/core/identity/account-guard.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import type {
  Principal,
  SessionView,
} from '../../../lib/core/session/session-view.ts';
import { StoreAccountGuard } from './account-guard.ts';
import { IDENTITY_TYPES } from './identity-types.ts';
import type { UserAccountStore, UserRecord } from './ports.ts';

const USER_ID = '01JUSER0000000000000000000';
const SESSION_ID = '01JSESSION0000000000000000';
const REGISTERED_AT = new Date('2026-10-01T00:00:00.000Z');

const USER_PRINCIPAL: Principal = Object.freeze({
  kind: 'authenticated',
  subjectKind: 'user',
  subjectId: USER_ID,
  sessionId: SESSION_ID,
});

function sessionOf(principal: Principal): SessionView {
  return { principal: () => Promise.resolve(principal) };
}

function userOf(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: USER_ID,
    status: 'active',
    emailVerifiedAt: REGISTERED_AT,
    deletedAt: null,
    pseudonymousId: '01JPSEUDONYM00000000000000',
    email: 'user@mail.example',
    passwordHash: 'pbkdf2-sha512$100000$salt$derived',
    nickname: '利用者',
    handle: 'user_1',
    disposableEmailStatus: 'regular',
    termsAgreedAt: REGISTERED_AT,
    lifecycleVersion: 0,
    ...overrides,
  };
}

const VIEW_KEYS = [
  'id',
  'pseudonymousId',
  'status',
  'emailVerifiedAt',
  'deletedAt',
  'email',
  'nickname',
  'handle',
] as const;

const viewOf = (user: UserRecord): UserAccountView => ({
  id: user.id,
  pseudonymousId: user.pseudonymousId,
  status: user.status,
  emailVerifiedAt: user.emailVerifiedAt,
  deletedAt: user.deletedAt,
  email: user.email,
  nickname: user.nickname,
  handle: user.handle,
});

function createStore(
  user: UserRecord | undefined,
  reads: string[],
): UserAccountStore {
  const unused = (): never => {
    throw new Error('判定では使わない');
  };
  return {
    findById(userId) {
      reads.push(userId);
      return Promise.resolve(user?.id === userId ? user : undefined);
    },
    findNotWithdrawnByEmail: unused,
    isEmailInUse: unused,
    createWithVerification: unused,
    markEmailVerified: unused,
    saveDisposableStatus: unused,
    applyPasswordReset: unused,
    applyEmailChange: unused,
    applyPasswordChange: unused,
    listUndetermined: unused,
  };
}

function setup(user: UserRecord | undefined) {
  const reads: string[] = [];
  const guard: AccountGuard = new StoreAccountGuard(createStore(user, reads));
  return { guard, reads };
}

const UNAUTHENTICATED = {
  kind: 'unauthenticated',
  code: 'unauthenticated',
  message: 'ログインが必要です。',
} as const;

const ACCOUNT_UNAVAILABLE = {
  kind: 'forbidden',
  code: 'account_unavailable',
  message:
    'このアカウントは現在ご利用いただけません。詳しくはお問い合わせください。',
} as const;

const EMAIL_NOT_VERIFIED = {
  kind: 'forbidden',
  code: 'email_not_verified',
  message:
    'この操作にはメールアドレスの確認が必要です。確認メールをご確認ください。',
} as const;

async function rejectionOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) {
      return error;
    }
    throw error;
  }
  throw new Error('拒否されなかった');
}

function shapeOf(error: AppError) {
  return { kind: error.kind, code: error.code, message: error.message };
}

const NOT_LOGGED_IN: readonly (readonly [string, Principal])[] = [
  ['未ログイン', { kind: 'anonymous' }],
  [
    '管理者の主体',
    {
      kind: 'authenticated',
      subjectKind: 'admin',
      subjectId: USER_ID,
      sessionId: SESSION_ID,
    },
  ],
];

describe('StoreAccountGuard.currentUser', () => {
  test('利用者のセッションなら主体と利用者を返す', async () => {
    const user = userOf();
    const { guard, reads } = setup(user);

    const current = await guard.currentUser(sessionOf(USER_PRINCIPAL));

    expect(current).toEqual<CurrentUser>({
      principal: USER_PRINCIPAL,
      user: viewOf(user),
    });
    expect(reads).toEqual([USER_ID]);
  });

  test.each(NOT_LOGGED_IN)(
    '%sなら利用者を読まずに値無しを返す',
    async (_label, principal) => {
      const { guard, reads } = setup(userOf());

      const current = await guard.currentUser(sessionOf(principal));

      expect(current).toBeUndefined();
      expect(reads).toEqual([]);
    },
  );

  test('利用者が見つからなければ値無しを返す', async () => {
    const { guard } = setup(undefined);

    expect(await guard.currentUser(sessionOf(USER_PRINCIPAL))).toBeUndefined();
  });

  test('利用者が退会済みなら未ログインと同じく値無しを返す', async () => {
    const { guard } = setup(userOf({ deletedAt: REGISTERED_AT }));

    expect(await guard.currentUser(sessionOf(USER_PRINCIPAL))).toBeUndefined();
  });

  test('停止中・未確認の利用者も返す', async () => {
    const user = userOf({ status: 'suspended', emailVerifiedAt: null });
    const { guard } = setup(user);

    expect(await guard.currentUser(sessionOf(USER_PRINCIPAL))).toEqual({
      principal: USER_PRINCIPAL,
      user: viewOf(user),
    });
  });
});

describe('StoreAccountGuard.requireUser', () => {
  test.each(NOT_LOGGED_IN)(
    '%sならunauthenticatedで拒否する',
    async (_label, principal) => {
      const { guard } = setup(userOf());

      const error = await rejectionOf(guard.requireUser(sessionOf(principal)));

      expect(shapeOf(error)).toEqual(UNAUTHENTICATED);
    },
  );

  test.each([
    ['見つからない', undefined],
    ['退会済み', userOf({ deletedAt: REGISTERED_AT })],
  ])('利用者が%sならunauthenticatedで拒否する', async (_label, user) => {
    const { guard } = setup(user);

    const error = await rejectionOf(
      guard.requireUser(sessionOf(USER_PRINCIPAL)),
    );

    expect(shapeOf(error)).toEqual(UNAUTHENTICATED);
  });

  test.each([
    ['停止中', userOf({ status: 'suspended' })],
    ['メールアドレスが未確認', userOf({ emailVerifiedAt: null })],
    ['通常', userOf()],
  ])('%sの利用者は通す', async (_label, user) => {
    const { guard } = setup(user);

    expect(await guard.requireUser(sessionOf(USER_PRINCIPAL))).toEqual({
      principal: USER_PRINCIPAL,
      user: viewOf(user),
    });
  });
});

describe('StoreAccountGuard.requireWritableUser', () => {
  test('未ログインならunauthenticatedで拒否する', async () => {
    const { guard } = setup(userOf());

    const error = await rejectionOf(
      guard.requireWritableUser(sessionOf({ kind: 'anonymous' })),
    );

    expect(shapeOf(error)).toEqual(UNAUTHENTICATED);
  });

  test('停止中ならaccount_unavailableで拒否する', async () => {
    const { guard } = setup(userOf({ status: 'suspended' }));

    const error = await rejectionOf(
      guard.requireWritableUser(sessionOf(USER_PRINCIPAL)),
    );

    expect(shapeOf(error)).toEqual(ACCOUNT_UNAVAILABLE);
  });

  test.each([
    ['メールアドレスが未確認', userOf({ emailVerifiedAt: null })],
    ['通常', userOf()],
  ])('%sの利用者は通す', async (_label, user) => {
    const { guard } = setup(user);

    expect(await guard.requireWritableUser(sessionOf(USER_PRINCIPAL))).toEqual({
      principal: USER_PRINCIPAL,
      user: viewOf(user),
    });
  });
});

describe('StoreAccountGuard.requireVerifiedUser', () => {
  test('未ログインならunauthenticatedで拒否する', async () => {
    const { guard } = setup(userOf());

    const error = await rejectionOf(
      guard.requireVerifiedUser(sessionOf({ kind: 'anonymous' })),
    );

    expect(shapeOf(error)).toEqual(UNAUTHENTICATED);
  });

  test('メールアドレスが未確認ならemail_not_verifiedで拒否する', async () => {
    const { guard } = setup(userOf({ emailVerifiedAt: null }));

    const error = await rejectionOf(
      guard.requireVerifiedUser(sessionOf(USER_PRINCIPAL)),
    );

    expect(shapeOf(error)).toEqual(EMAIL_NOT_VERIFIED);
  });

  test('停止中かつ未確認なら停止中を優先してaccount_unavailableで拒否する', async () => {
    const { guard } = setup(
      userOf({ status: 'suspended', emailVerifiedAt: null }),
    );

    const error = await rejectionOf(
      guard.requireVerifiedUser(sessionOf(USER_PRINCIPAL)),
    );

    expect(shapeOf(error)).toEqual(ACCOUNT_UNAVAILABLE);
  });

  test('確認済みで停止中でない利用者は通す', async () => {
    const user = userOf();
    const { guard } = setup(user);

    expect(await guard.requireVerifiedUser(sessionOf(USER_PRINCIPAL))).toEqual({
      principal: USER_PRINCIPAL,
      user: viewOf(user),
    });
  });
});

describe('StoreAccountGuard の返す利用者', () => {
  test.each([
    ['currentUser'],
    ['requireUser'],
    ['requireWritableUser'],
    ['requireVerifiedUser'],
  ] as const)(
    '%sが返す利用者は読み取りの形の項目だけを持ち、パスワードのハッシュ・版などを持たない',
    async (method) => {
      const { guard } = setup(userOf({ lifecycleVersion: 4 }));

      const current = await guard[method](sessionOf(USER_PRINCIPAL));

      expect(Object.keys(current?.user ?? {}).toSorted()).toEqual(
        [...VIEW_KEYS].toSorted(),
      );
      expect(current?.user).not.toHaveProperty('passwordHash');
      expect(current?.user).not.toHaveProperty('lifecycleVersion');
      expect(current?.user).not.toHaveProperty('disposableEmailStatus');
      expect(current?.user).not.toHaveProperty('termsAgreedAt');
    },
  );
});

describe('StoreAccountGuard の読み取りの回数', () => {
  test('同じ要求で判定を何度呼んでも利用者を1回だけ読む', async () => {
    const { guard, reads } = setup(userOf());
    const session = sessionOf(USER_PRINCIPAL);

    await guard.currentUser(session);
    await guard.requireUser(session);
    await guard.requireWritableUser(session);
    await guard.requireVerifiedUser(session);

    expect(reads).toEqual([USER_ID]);
  });

  test('並行に呼んでも利用者を1回だけ読む', async () => {
    const { guard, reads } = setup(userOf());
    const session = sessionOf(USER_PRINCIPAL);

    await Promise.all([
      guard.currentUser(session),
      guard.requireVerifiedUser(session),
    ]);

    expect(reads).toEqual([USER_ID]);
  });

  test('見つからなかった結果も同じ要求の中では読み直さない', async () => {
    const { guard, reads } = setup(undefined);
    const session = sessionOf(USER_PRINCIPAL);

    await guard.currentUser(session);
    await guard.currentUser(session);

    expect(reads).toEqual([USER_ID]);
  });

  test('処理単位で単一に束縛すると、同じ要求で解決した判定は利用者を1回だけ読む', async () => {
    const reads: string[] = [];
    const container = new Container();
    container
      .bind<UserAccountStore>(IDENTITY_TYPES.UserAccountStore)
      .toConstantValue(createStore(userOf(), reads));
    container
      .bind<AccountGuard>(IDENTITY_PLATFORM_TYPES.AccountGuard)
      .to(StoreAccountGuard)
      .inSingletonScope();
    const session = sessionOf(USER_PRINCIPAL);

    await container
      .get<AccountGuard>(IDENTITY_PLATFORM_TYPES.AccountGuard)
      .requireUser(session);
    await container
      .get<AccountGuard>(IDENTITY_PLATFORM_TYPES.AccountGuard)
      .requireWritableUser(session);

    expect(reads).toEqual([USER_ID]);
  });
});
