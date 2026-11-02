import { describe, expect, test } from 'bun:test';
import { Container } from 'inversify';

import type { HashPurpose } from '../../../lib/core/crypto/keyed-hasher.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type { DisposableEmailStatus } from '../../../lib/core/identity/disposable-email.ts';
import { AUTH_TOKEN_HASH_PURPOSES } from '../../domain/identity/auth-token-purpose.ts';
import { AUTH_TYPES } from '../auth/auth-types.ts';
import type { SecretIssuer } from '../auth/secret-issuer.ts';
import type { Principal } from '../session/session-verifier.ts';
import type { SessionView } from '../session/session-view.ts';
import { type AccountGuard, StoreAccountGuard } from './account-guard.ts';
import type { DisposableEmailCheck } from './disposable-email-check.ts';
import {
  type EmailVerification,
  StoreEmailVerification,
} from './email-verification.ts';
import { IDENTITY_TYPES } from './identity-types.ts';
import type {
  AuthTokenStore,
  ConsumedAuthToken,
  IdentityMailer,
  LimitedMailKind,
  MailSendLimits,
  NewAuthToken,
  UserAccountStore,
  UserRecord,
} from './ports.ts';
import type { RequestMeta } from './request-meta.ts';

const NOW = new Date('2026-11-02T03:04:05.678Z');

const HOUR_MS = 60 * 60 * 1000;

const REGISTERED_AT = new Date('2026-10-01T00:00:00.000Z');

const USER_ID = '01JVERIFY00000000000000001';

const SESSION_ID = '01JVERIFYSESSION0000000001';

const TOKEN = 'plain-verification-token';

const META: RequestMeta = {
  clientIp: '192.0.2.10',
  userAgent: 'Mozilla/5.0',
  now: NOW,
};

const USER_PRINCIPAL: Principal = Object.freeze({
  kind: 'authenticated',
  subjectKind: 'user',
  subjectId: USER_ID,
  sessionId: SESSION_ID,
});

const INVALID_LINK = {
  kind: 'unprocessable',
  code: 'invalid_link',
  message: 'このリンクは無効か、有効期限が切れています。',
} as const;

function userOf(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: USER_ID,
    status: 'active',
    emailVerifiedAt: null,
    deletedAt: null,
    pseudonymousId: '0b9c6f0e-6a55-4a1f-9d4e-2f3c5b7a8d91',
    email: 'Taro.Yamada@mail.example',
    passwordHash: 'pbkdf2-sha512$100000$salt$derived',
    nickname: 'やまだ たろう',
    handle: 'handle000001',
    disposableEmailStatus: null,
    termsAgreedAt: REGISTERED_AT,
    lifecycleVersion: 0,
    ...overrides,
  };
}

function sessionOf(principal: Principal): SessionView {
  return { principal: () => Promise.resolve(principal) };
}

interface FakeOptions {
  readonly user?: UserRecord;
  readonly consumed?: ConsumedAuthToken;
  readonly limitError?: Error;
  readonly mailError?: Error;
  readonly disposableStatus?: DisposableEmailStatus;
  readonly disposableError?: Error;
}

interface Recorded {
  readonly calls: string[];
  readonly hashed: { readonly purpose: HashPurpose; readonly plain: string }[];
  readonly consumes: {
    readonly purpose: string;
    readonly tokenHash: string;
    readonly now: Date;
  }[];
  readonly reads: string[];
  readonly verified: { readonly userId: string; readonly at: Date }[];
  readonly disposableChecks: {
    readonly user: UserRecord;
    readonly at: Date;
  }[];
  readonly limits: {
    readonly kind: LimitedMailKind;
    readonly address: string;
    readonly meta: RequestMeta;
  }[];
  readonly issued: { readonly purpose: HashPurpose; readonly plain: string }[];
  readonly replaced: NewAuthToken[];
  readonly mails: {
    readonly to: UserRecord;
    readonly token: string;
    readonly expiresAt: Date;
  }[];
}

const notUsed = (): never => {
  throw new Error('メールアドレスの確認では使わない');
};

const hashOfPlain = (purpose: HashPurpose, plain: string): string =>
  `hashed(${purpose}):${plain}`;

function createFakes(options: FakeOptions = {}) {
  const recorded: Recorded = {
    calls: [],
    hashed: [],
    consumes: [],
    reads: [],
    verified: [],
    disposableChecks: [],
    limits: [],
    issued: [],
    replaced: [],
    mails: [],
  };
  const user = 'user' in options ? options.user : userOf();
  const consumed: ConsumedAuthToken | undefined =
    'consumed' in options
      ? options.consumed
      : { userId: USER_ID, newEmail: null, pendingPasswordHash: null };

  const secrets: SecretIssuer = {
    issue(purpose) {
      recorded.calls.push('secrets.issue');
      const plain = `issued-secret-${String(recorded.issued.length + 1)}`;
      recorded.issued.push({ purpose, plain });
      return Promise.resolve({ plain, hash: hashOfPlain(purpose, plain) });
    },
    hashOf(purpose, plain) {
      recorded.calls.push('secrets.hashOf');
      recorded.hashed.push({ purpose, plain });
      return Promise.resolve(hashOfPlain(purpose, plain));
    },
  };

  const tokens: AuthTokenStore = {
    replace(token) {
      recorded.calls.push('tokens.replace');
      recorded.replaced.push(token);
      return Promise.resolve();
    },
    findValid: notUsed,
    consume(purpose, tokenHash, now) {
      recorded.calls.push('tokens.consume');
      recorded.consumes.push({ purpose, tokenHash, now });
      return Promise.resolve(consumed);
    },
    deleteExpired: notUsed,
  };

  const users: UserAccountStore = {
    findById(userId) {
      recorded.calls.push('users.findById');
      recorded.reads.push(userId);
      return Promise.resolve(user?.id === userId ? user : undefined);
    },
    findNotWithdrawnByEmail: notUsed,
    isEmailInUse: notUsed,
    createWithVerification: notUsed,
    markEmailVerified(userId, at) {
      recorded.calls.push('users.markEmailVerified');
      recorded.verified.push({ userId, at });
      return Promise.resolve();
    },
    saveDisposableStatus: notUsed,
    applyPasswordReset: notUsed,
    applyEmailChange: notUsed,
    applyPasswordChange: notUsed,
    listUndetermined: notUsed,
  };

  const disposableCheck: DisposableEmailCheck = {
    checkAndSave(checkedUser, at) {
      recorded.calls.push('disposableCheck.checkAndSave');
      recorded.disposableChecks.push({ user: checkedUser, at });
      return options.disposableError === undefined
        ? Promise.resolve(options.disposableStatus ?? 'regular')
        : Promise.reject(options.disposableError);
    },
  };

  const limits: MailSendLimits = {
    consume(kind, address, meta) {
      recorded.calls.push('limits.consume');
      recorded.limits.push({ kind, address, meta });
      return options.limitError === undefined
        ? Promise.resolve()
        : Promise.reject(options.limitError);
    },
  };

  const mailer: IdentityMailer = {
    sendEmailVerification(to, token, expiresAt) {
      recorded.calls.push('mailer.sendEmailVerification');
      recorded.mails.push({ to, token, expiresAt });
      return options.mailError === undefined
        ? Promise.resolve()
        : Promise.reject(options.mailError);
    },
    sendEmailChangeConfirmation: notUsed,
    sendEmailChanged: notUsed,
    sendPasswordReset: notUsed,
    sendPasswordResetCompleted: notUsed,
    sendPasswordChangeConfirmation: notUsed,
    sendPasswordChanged: notUsed,
  };

  const guard: AccountGuard = new StoreAccountGuard(users);

  return {
    recorded,
    secrets,
    tokens,
    users,
    disposableCheck,
    guard,
    limits,
    mailer,
  };
}

type Fakes = ReturnType<typeof createFakes>;

function createVerification(fakes: Fakes): EmailVerification {
  return new StoreEmailVerification(
    fakes.secrets,
    fakes.tokens,
    fakes.users,
    fakes.disposableCheck,
    fakes.guard,
    fakes.limits,
    fakes.mailer,
  );
}

function setup(options: FakeOptions = {}) {
  const fakes = createFakes(options);
  return {
    fakes,
    recorded: fakes.recorded,
    verification: createVerification(fakes),
  };
}

async function caught(action: Promise<unknown>): Promise<AppError> {
  try {
    await action;
  } catch (error: unknown) {
    if (error instanceof AppError) {
      return error;
    }
    throw error;
  }
  throw new Error('例外が発生しませんでした。');
}

function shapeOf(error: AppError) {
  return { kind: error.kind, code: error.code, message: error.message };
}

describe('StoreEmailVerification.verify', () => {
  test('確認の用途でハッシュ化したトークンを現在時刻で消費し、利用者を確認済みにしてから使い捨て判定を保存する', async () => {
    const { verification, recorded } = setup();

    await verification.verify(TOKEN, META);

    expect(recorded.hashed).toEqual([
      {
        purpose: AUTH_TOKEN_HASH_PURPOSES.email_verification,
        plain: TOKEN,
      },
    ]);
    expect(recorded.consumes).toEqual([
      {
        purpose: 'email_verification',
        tokenHash: hashOfPlain(
          AUTH_TOKEN_HASH_PURPOSES.email_verification,
          TOKEN,
        ),
        now: NOW,
      },
    ]);
    expect(recorded.verified).toEqual([{ userId: USER_ID, at: NOW }]);
    expect(recorded.disposableChecks).toEqual([{ user: userOf(), at: NOW }]);
    expect(recorded.calls).toEqual([
      'secrets.hashOf',
      'tokens.consume',
      'users.findById',
      'users.markEmailVerified',
      'disposableCheck.checkAndSave',
    ]);
  });

  test('確認済みの更新はストアのmarkEmailVerifiedに任せ、新しいトークンを発行・保存しない', async () => {
    const { verification, recorded } = setup();

    await verification.verify(TOKEN, META);

    expect(recorded.verified).toEqual([{ userId: USER_ID, at: NOW }]);
    expect(recorded.replaced).toEqual([]);
  });

  test('判定が「未判定」でも、メールアドレスの確認を完了する', async () => {
    const { verification, recorded } = setup({
      disposableStatus: 'undetermined',
    });

    await verification.verify(TOKEN, META);

    expect(recorded.verified).toHaveLength(1);
    expect(recorded.disposableChecks).toHaveLength(1);
  });

  test('使い捨て判定の保存に失敗しても、確認済みにした後のため成功を返す', async () => {
    const { verification, recorded } = setup({
      disposableError: new Error('D1の書き込みに失敗しました'),
    });

    await verification.verify(TOKEN, META);

    expect(recorded.verified).toEqual([{ userId: USER_ID, at: NOW }]);
    expect(recorded.disposableChecks).toHaveLength(1);
  });

  test('無効・期限切れ・使用済みのトークンは422のinvalid_linkで拒否し、利用者を読まず何も更新しない', async () => {
    const { verification, recorded } = setup({ consumed: undefined });

    const error = await caught(verification.verify(TOKEN, META));

    expect(shapeOf(error)).toEqual(INVALID_LINK);
    expect(recorded.reads).toEqual([]);
    expect(recorded.verified).toEqual([]);
    expect(recorded.disposableChecks).toEqual([]);
  });

  test('退会済みの利用者のトークンはinvalid_linkで拒否し、確認済みにせず判定もしない', async () => {
    const { verification, recorded } = setup({
      user: userOf({ deletedAt: new Date('2026-11-01T00:00:00.000Z') }),
    });

    const error = await caught(verification.verify(TOKEN, META));

    expect(shapeOf(error)).toEqual(INVALID_LINK);
    expect(recorded.verified).toEqual([]);
    expect(recorded.disposableChecks).toEqual([]);
  });

  test('物理削除などで利用者が無いトークンはinvalid_linkで拒否する', async () => {
    const { verification, recorded } = setup({ user: undefined });

    const error = await caught(verification.verify(TOKEN, META));

    expect(shapeOf(error)).toEqual(INVALID_LINK);
    expect(recorded.verified).toEqual([]);
  });
});

describe('StoreEmailVerification.resend', () => {
  test('未確認の利用者には、送信回数を数えてから未使用のトークンを置き換え、24時間有効な新しいリンクを送って「sent」を返す', async () => {
    const { verification, recorded } = setup();

    const result = await verification.resend(sessionOf(USER_PRINCIPAL), META);

    expect(result).toBe('sent');
    expect(recorded.calls).toEqual([
      'users.findById',
      'limits.consume',
      'secrets.issue',
      'tokens.replace',
      'mailer.sendEmailVerification',
    ]);
    expect(recorded.limits).toEqual([
      { kind: 'email_verification', address: userOf().email, meta: META },
    ]);
    const plain = recorded.issued[0]?.plain ?? '-';
    expect(recorded.issued).toEqual([
      { purpose: AUTH_TOKEN_HASH_PURPOSES.email_verification, plain },
    ]);
    const expiresAt = new Date(NOW.getTime() + 24 * HOUR_MS);
    expect(recorded.replaced).toEqual([
      {
        userId: USER_ID,
        purpose: 'email_verification',
        tokenHash: hashOfPlain(
          AUTH_TOKEN_HASH_PURPOSES.email_verification,
          plain,
        ),
        expiresAt,
      },
    ]);
    expect(recorded.mails).toEqual([{ to: userOf(), token: plain, expiresAt }]);
  });

  test('確認済みの利用者には、回数を数えずトークンも変えずにメールを送らず「already-verified」を返す', async () => {
    const { verification, recorded } = setup({
      user: userOf({ emailVerifiedAt: REGISTERED_AT }),
    });

    const result = await verification.resend(sessionOf(USER_PRINCIPAL), META);

    expect(result).toBe('already-verified');
    expect(recorded.limits).toEqual([]);
    expect(recorded.replaced).toEqual([]);
    expect(recorded.mails).toEqual([]);
  });

  test('停止中の利用者は403のaccount_unavailableで拒否し、回数を数えずメールを送らない', async () => {
    const { verification, recorded } = setup({
      user: userOf({ status: 'suspended' }),
    });

    const error = await caught(
      verification.resend(sessionOf(USER_PRINCIPAL), META),
    );

    expect(error.kind).toBe('forbidden');
    expect(error.code).toBe('account_unavailable');
    expect(recorded.limits).toEqual([]);
    expect(recorded.replaced).toEqual([]);
    expect(recorded.mails).toEqual([]);
  });

  test('未ログインの要求は401のunauthenticatedで拒否する', async () => {
    const { verification, recorded } = setup();

    const error = await caught(
      verification.resend(sessionOf({ kind: 'anonymous' }), META),
    );

    expect(error.kind).toBe('unauthenticated');
    expect(error.code).toBe('unauthenticated');
    expect(recorded.limits).toEqual([]);
  });

  test('送信回数が上限なら、その例外をそのまま投げてトークンを置き換えずメールを送らない', async () => {
    const limitError = new AppError({
      kind: 'rate_limited',
      code: 'rate_limit_exceeded',
      message: '操作が集中しています。しばらく待ってから再度お試しください。',
      retryAfterSeconds: 1200,
    });
    const { verification, recorded } = setup({ limitError });

    const error = await caught(
      verification.resend(sessionOf(USER_PRINCIPAL), META),
    );

    expect(error).toBe(limitError);
    expect(recorded.issued).toEqual([]);
    expect(recorded.replaced).toEqual([]);
    expect(recorded.mails).toEqual([]);
  });

  test('確認メールの送信要求に失敗したら、利用者が再度試せるよう例外をそのまま投げる', async () => {
    const mailError = new Error('送信の受付に失敗しました');
    const { verification } = setup({ mailError });

    const rejection: unknown = await verification
      .resend(sessionOf(USER_PRINCIPAL), META)
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(rejection).toBe(mailError);
  });
});

describe('StoreEmailVerification', () => {
  test('コンテナで依存を注入して解決できる', async () => {
    const fakes = createFakes();
    const container = new Container();
    container
      .bind<SecretIssuer>(AUTH_TYPES.SecretIssuer)
      .toConstantValue(fakes.secrets);
    container
      .bind<AuthTokenStore>(IDENTITY_TYPES.AuthTokenStore)
      .toConstantValue(fakes.tokens);
    container
      .bind<UserAccountStore>(IDENTITY_TYPES.UserAccountStore)
      .toConstantValue(fakes.users);
    container
      .bind<DisposableEmailCheck>(IDENTITY_TYPES.DisposableEmailCheck)
      .toConstantValue(fakes.disposableCheck);
    container
      .bind<AccountGuard>(IDENTITY_TYPES.AccountGuard)
      .toConstantValue(fakes.guard);
    container
      .bind<MailSendLimits>(IDENTITY_TYPES.MailSendLimits)
      .toConstantValue(fakes.limits);
    container
      .bind<IdentityMailer>(IDENTITY_TYPES.IdentityMailer)
      .toConstantValue(fakes.mailer);
    container
      .bind<EmailVerification>(IDENTITY_TYPES.EmailVerification)
      .to(StoreEmailVerification);

    const verification = container.get<EmailVerification>(
      IDENTITY_TYPES.EmailVerification,
    );
    await verification.verify(TOKEN, META);
    const result = await verification.resend(sessionOf(USER_PRINCIPAL), META);

    expect(fakes.recorded.verified).toHaveLength(1);
    expect(result).toBe('sent');
  });
});
