import { describe, expect, test } from 'bun:test';

import type { HashPurpose } from '../../../lib/core/crypto/keyed-hasher.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type { PasswordIdentifiers } from '../../domain/auth/password-rules.ts';
import {
  AUTH_TOKEN_HASH_PURPOSES,
  type AuthTokenPurpose,
} from '../../domain/identity/auth-token-purpose.ts';
import type {
  NewPasswordValidation,
  PasswordPolicy,
} from '../auth/password-policy.ts';
import type { PasswordHasher } from '../auth/ports.ts';
import type { SecretIssuer } from '../auth/secret-issuer.ts';
import { type PasswordReset, StorePasswordReset } from './password-reset.ts';
import type {
  AuthTokenStore,
  IdentityMailer,
  LimitedMailKind,
  MailSendLimits,
  UserAccountStore,
  UserRecord,
} from './ports.ts';
import type { RequestMeta } from './request-meta.ts';

const NOW = new Date('2026-11-02T03:04:05.678Z');

const MINUTE_MS = 60 * 1000;

const USER_ID = '01JRESET000000000000000001';

const EMAIL = 'Taro.Yamada@mail.example';

const TOKEN = 'plain-password-reset-token';

const NEW_PASSWORD = ['correct', 'horse', 'battery', 'staple'].join(' ');

const RESET_PURPOSE = AUTH_TOKEN_HASH_PURPOSES.password_reset;

const META: RequestMeta = {
  clientIp: '192.0.2.10',
  userAgent: 'Mozilla/5.0',
  now: NOW,
};

const INVALID_LINK = {
  kind: 'unprocessable',
  code: 'invalid_link',
  message: 'このリンクは無効か、有効期限が切れています。',
} as const;

const RATE_LIMITED = new AppError({
  kind: 'rate_limited',
  code: 'rate_limit_exceeded',
  message: '操作が集中しています。しばらく待ってから再度お試しください。',
  retryAfterSeconds: 1200,
});

function userOf(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: USER_ID,
    status: 'active',
    emailVerifiedAt: new Date('2026-10-01T00:00:00.000Z'),
    deletedAt: null,
    pseudonymousId: '0b9c6f0e-6a55-4a1f-9d4e-2f3c5b7a8d91',
    email: EMAIL,
    passwordHash: 'pbkdf2-sha512$100000$salt$derived',
    nickname: 'やまだ たろう',
    handle: 'taroyamada01',
    disposableEmailStatus: 'regular',
    termsAgreedAt: new Date('2026-09-01T00:00:00.000Z'),
    lifecycleVersion: 0,
    ...overrides,
  };
}

const hashOfPlain = (purpose: HashPurpose, plain: string): string =>
  `hashed(${purpose}):${plain}`;

const storedHashOf = (password: string): string => `stored(${password})`;

interface StoredToken {
  readonly userId: string;
  readonly purpose: AuthTokenPurpose;
  readonly tokenHash: string;
  readonly expiresAt: Date;
}

interface FakeOptions {
  readonly user?: UserRecord;
  readonly tokens?: readonly StoredToken[];
  readonly validation?: NewPasswordValidation;
  readonly limitError?: Error;
  readonly mailError?: Error;
  readonly applyError?: Error;
  // findValidの後、consumeの前に同じトークンが別の確定で使われたことを再現する
  readonly consumedConcurrently?: boolean;
}

interface Recorded {
  readonly calls: string[];
  readonly limits: {
    readonly kind: LimitedMailKind;
    readonly address: string;
    readonly meta: RequestMeta;
  }[];
  readonly lookups: string[];
  readonly issued: { readonly purpose: HashPurpose; readonly plain: string }[];
  readonly hashed: { readonly purpose: HashPurpose; readonly plain: string }[];
  readonly policyChecks: {
    readonly password: string;
    readonly identifiers: PasswordIdentifiers;
  }[];
  readonly passwordHashes: string[];
  readonly applied: {
    readonly userId: string;
    readonly passwordHash: string;
    readonly at: Date;
  }[];
  readonly resetMails: {
    readonly user: UserRecord;
    readonly token: string;
    readonly expiresAt: Date;
  }[];
  readonly completedMails: { readonly user: UserRecord; readonly at: Date }[];
}

// 使わないメソッドを呼んだら失敗させ、ユースケースが想定外のポートに触れたことを検出する
function partialFake<T extends object>(implemented: Partial<T>): T {
  return new Proxy(implemented, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) {
        return Reflect.get(target, property, receiver) as unknown;
      }
      return () => {
        throw new Error(`この偽物では使わない: ${String(property)}`);
      };
    },
  }) as T;
}

const settle = <T>(
  promise: Promise<T>,
  error: Error | undefined,
  value: T,
): Promise<T> =>
  promise.then(() => (error === undefined ? value : Promise.reject<T>(error)));

function createAccountFakes(
  recorded: Recorded,
  user: UserRecord | undefined,
  applyError: Error | undefined,
): UserAccountStore {
  return partialFake<UserAccountStore>({
    // ユースケース側が退会済みを除くことを確かめるため、退会済みの利用者も返す
    findNotWithdrawnByEmail(email) {
      recorded.calls.push('users.findNotWithdrawnByEmail');
      recorded.lookups.push(email);
      return Promise.resolve(
        user !== undefined && user.email.toLowerCase() === email.toLowerCase()
          ? user
          : undefined,
      );
    },
    findById(userId) {
      recorded.calls.push('users.findById');
      return Promise.resolve(user?.id === userId ? user : undefined);
    },
    applyPasswordReset(userId, passwordHash, at) {
      recorded.calls.push('users.applyPasswordReset');
      recorded.applied.push({ userId, passwordHash, at });
      return settle(Promise.resolve(), applyError, undefined);
    },
  });
}

function createTokenStore(
  recorded: Recorded,
  stored: StoredToken[],
  options: FakeOptions,
): AuthTokenStore {
  const indexOfValid = (
    purpose: AuthTokenPurpose,
    tokenHash: string,
    now: Date,
  ): number =>
    stored.findIndex(
      (token) =>
        token.purpose === purpose &&
        token.tokenHash === tokenHash &&
        token.expiresAt.getTime() > now.getTime(),
    );
  const consumedOf = (token: StoredToken) => ({
    userId: token.userId,
    newEmail: null,
    pendingPasswordHash: null,
  });
  return partialFake<AuthTokenStore>({
    replace(token) {
      recorded.calls.push('tokens.replace');
      const kept = stored.filter(
        (existing) =>
          existing.userId !== token.userId ||
          existing.purpose !== token.purpose,
      );
      stored.splice(0, stored.length, ...kept, token);
      return Promise.resolve();
    },
    findValid(purpose, tokenHash, now) {
      recorded.calls.push('tokens.findValid');
      const found = stored[indexOfValid(purpose, tokenHash, now)];
      return Promise.resolve(
        found === undefined ? undefined : consumedOf(found),
      );
    },
    consume(purpose, tokenHash, now) {
      recorded.calls.push('tokens.consume');
      if (options.consumedConcurrently === true) {
        return Promise.resolve(undefined);
      }
      const index = indexOfValid(purpose, tokenHash, now);
      const [found] = index < 0 ? [] : stored.splice(index, 1);
      return Promise.resolve(
        found === undefined ? undefined : consumedOf(found),
      );
    },
  });
}

function createSecurityFakes(recorded: Recorded, options: FakeOptions) {
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
  const policy: PasswordPolicy = {
    validateNewPassword(password, identifiers) {
      recorded.calls.push('policy.validateNewPassword');
      recorded.policyChecks.push({ password, identifiers });
      return Promise.resolve(
        options.validation ?? { ok: true, pwnedCheck: 'checked' },
      );
    },
  };
  const hasher = partialFake<PasswordHasher>({
    hash(password) {
      recorded.calls.push('password.hash');
      const hash = storedHashOf(password);
      recorded.passwordHashes.push(hash);
      return Promise.resolve(hash);
    },
  });
  return { secrets, policy, hasher };
}

function createMailFakes(recorded: Recorded, options: FakeOptions) {
  const limits: MailSendLimits = {
    consume(kind, address, meta) {
      recorded.calls.push('limits.consume');
      recorded.limits.push({ kind, address, meta });
      return settle(Promise.resolve(), options.limitError, undefined);
    },
  };
  const mailer = partialFake<IdentityMailer>({
    sendPasswordReset(user, token, expiresAt) {
      recorded.calls.push('mailer.sendPasswordReset');
      recorded.resetMails.push({ user, token, expiresAt });
      return settle(Promise.resolve(), options.mailError, undefined);
    },
    sendPasswordResetCompleted(user, at) {
      recorded.calls.push('mailer.sendPasswordResetCompleted');
      recorded.completedMails.push({ user, at });
      return settle(Promise.resolve(), options.mailError, undefined);
    },
  });
  return { limits, mailer };
}

const RESET_TOKEN: StoredToken = {
  userId: USER_ID,
  purpose: 'password_reset',
  tokenHash: hashOfPlain(RESET_PURPOSE, TOKEN),
  expiresAt: new Date(NOW.getTime() + 10 * MINUTE_MS),
};

function setup(options: FakeOptions = {}) {
  const recorded: Recorded = {
    calls: [],
    limits: [],
    lookups: [],
    issued: [],
    hashed: [],
    policyChecks: [],
    passwordHashes: [],
    applied: [],
    resetMails: [],
    completedMails: [],
  };
  const user = 'user' in options ? options.user : userOf();
  const stored = [...(options.tokens ?? [RESET_TOKEN])];
  const { secrets, policy, hasher } = createSecurityFakes(recorded, options);
  const { limits, mailer } = createMailFakes(recorded, options);
  const passwordReset: PasswordReset = new StorePasswordReset(
    limits,
    createAccountFakes(recorded, user, options.applyError),
    createTokenStore(recorded, stored, options),
    secrets,
    policy,
    hasher,
    mailer,
  );
  return { passwordReset, recorded, stored };
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

const shapeOf = (error: AppError) => ({
  kind: error.kind,
  code: error.code,
  message: error.message,
});

const COMPLETE_INPUT = { token: TOKEN, newPassword: NEW_PASSWORD };

const NOT_TARGETS = [
  ['未登録', undefined],
  ['退会済み', userOf({ deletedAt: new Date('2026-11-01T00:00:00.000Z') })],
  ['停止中', userOf({ status: 'suspended' })],
] as const;

describe('StorePasswordReset.request', () => {
  test('停止中でない未退会の利用者には、送信回数を数えてから未使用のリセットのトークンを置き換え、30分有効なリンクを送る', async () => {
    const { passwordReset, recorded, stored } = setup({ tokens: [] });

    await passwordReset.request(EMAIL, META);

    expect(recorded.calls).toEqual([
      'limits.consume',
      'users.findNotWithdrawnByEmail',
      'secrets.issue',
      'tokens.replace',
      'mailer.sendPasswordReset',
    ]);
    expect(recorded.limits).toEqual([
      { kind: 'password_reset', address: EMAIL, meta: META },
    ]);
    const plain = recorded.issued[0]?.plain ?? '-';
    expect(recorded.issued).toEqual([{ purpose: RESET_PURPOSE, plain }]);
    const expiresAt = new Date(NOW.getTime() + 30 * MINUTE_MS);
    expect(stored).toEqual([
      {
        userId: USER_ID,
        purpose: 'password_reset',
        tokenHash: hashOfPlain(RESET_PURPOSE, plain),
        expiresAt,
      },
    ]);
    expect(recorded.resetMails).toEqual([
      { user: userOf(), token: plain, expiresAt },
    ]);
  });

  test('同じ利用者の未使用のリセットのリンクは新しいリンクに置き換わり、ほかの用途のトークンは残す', async () => {
    const changeToken: StoredToken = {
      userId: USER_ID,
      purpose: 'password_change',
      tokenHash: 'hashed(change)',
      expiresAt: new Date(NOW.getTime() + 10 * MINUTE_MS),
    };
    const { passwordReset, recorded, stored } = setup({
      tokens: [RESET_TOKEN, changeToken],
    });

    await passwordReset.request(EMAIL, META);

    const plain = recorded.issued[0]?.plain ?? '-';
    expect(stored.map((token) => token.tokenHash)).toEqual([
      changeToken.tokenHash,
      hashOfPlain(RESET_PURPOSE, plain),
    ]);
  });

  test('メールアドレスが未確認の利用者にもリンクを送る', async () => {
    const { passwordReset, recorded } = setup({
      user: userOf({ emailVerifiedAt: null }),
    });

    await passwordReset.request(EMAIL, META);

    expect(recorded.resetMails).toHaveLength(1);
  });

  test('入力の前後の空白を除いたメールアドレスで数え、利用者を探す', async () => {
    const { passwordReset, recorded } = setup();

    await passwordReset.request(`\u3000 ${EMAIL}\n`, META);

    expect(recorded.limits.map((limit) => limit.address)).toEqual([EMAIL]);
    expect(recorded.lookups).toEqual([EMAIL]);
    expect(recorded.resetMails).toHaveLength(1);
  });

  test.each(NOT_TARGETS)(
    '%sのメールアドレスでは、送信回数を同じく数えたうえで、トークンを作らずメールを送らない',
    async (_label, user) => {
      const { passwordReset, recorded } = setup({ user, tokens: [] });

      await passwordReset.request(EMAIL, META);

      expect(recorded.calls).toEqual([
        'limits.consume',
        'users.findNotWithdrawnByEmail',
      ]);
      expect(recorded.limits).toEqual([
        { kind: 'password_reset', address: EMAIL, meta: META },
      ]);
      expect(recorded.issued).toEqual([]);
      expect(recorded.resetMails).toEqual([]);
    },
  );

  test('アカウントの有無と状態を問わず、要求の結果は同じになる', async () => {
    const outcomes = await Promise.all(
      [
        userOf(),
        userOf({ emailVerifiedAt: null }),
        ...NOT_TARGETS.map(([, user]) => user),
      ].map(async (user) => {
        const { passwordReset } = setup({ user });
        return passwordReset.request(EMAIL, META).then(
          (value: unknown) => ({ resolved: value }),
          (error: unknown) => ({ rejected: error }),
        );
      }),
    );

    expect(outcomes).toEqual(
      Array.from({ length: 5 }, () => ({ resolved: undefined })),
    );
  });

  test('リンクのメールの送信要求に失敗しても、アカウントの有無を推測させないよう同じ結果を返す', async () => {
    const { passwordReset, recorded } = setup({
      mailError: new Error('送信の受付に失敗しました'),
    });

    await passwordReset.request(EMAIL, META);

    expect(recorded.resetMails).toHaveLength(1);
  });

  test.each([
    ['登録済み', userOf()],
    ['未登録', undefined],
  ] as const)(
    '送信回数が上限なら、%sでも同じ例外を投げ、利用者を探さずメールを送らない',
    async (_label, user) => {
      const { passwordReset, recorded } = setup({
        user,
        limitError: RATE_LIMITED,
      });

      const error = await caught(passwordReset.request(EMAIL, META));

      expect(error).toBe(RATE_LIMITED);
      expect(recorded.calls).toEqual(['limits.consume']);
      expect(recorded.resetMails).toEqual([]);
    },
  );
});

describe('StorePasswordReset.complete', () => {
  test('リセットの用途でハッシュ化したトークンで利用者を特定し、方針の確認とハッシュ化の後にトークンを消費して、パスワードの更新と完了メールを行う', async () => {
    const { passwordReset, recorded, stored } = setup();

    await passwordReset.complete(COMPLETE_INPUT, META);

    expect(recorded.calls).toEqual([
      'secrets.hashOf',
      'tokens.findValid',
      'users.findById',
      'policy.validateNewPassword',
      'password.hash',
      'tokens.consume',
      'users.applyPasswordReset',
      'mailer.sendPasswordResetCompleted',
    ]);
    expect(recorded.hashed).toEqual([{ purpose: RESET_PURPOSE, plain: TOKEN }]);
    expect(recorded.policyChecks).toEqual([
      {
        password: NEW_PASSWORD,
        identifiers: {
          handle: userOf().handle,
          nickname: userOf().nickname,
          email: userOf().email,
        },
      },
    ]);
    expect(recorded.applied).toEqual([
      { userId: USER_ID, passwordHash: storedHashOf(NEW_PASSWORD), at: NOW },
    ]);
    expect(recorded.completedMails).toEqual([{ user: userOf(), at: NOW }]);
    expect(stored).toEqual([]);
  });

  test('確認済み・全セッションの削除・未使用のリセットと変更のリンクの失効は、利用者のストアの1回のapplyPasswordResetに任せ、多要素認証の設定には触れない', async () => {
    const { passwordReset, recorded } = setup({
      user: userOf({ emailVerifiedAt: null }),
    });

    await passwordReset.complete(COMPLETE_INPUT, META);

    expect(recorded.applied).toHaveLength(1);
    const writes = recorded.calls.filter(
      (call) =>
        !call.startsWith('secrets.') &&
        !call.startsWith('policy.') &&
        !call.startsWith('password.') &&
        !call.includes('.find'),
    );
    expect(writes).toEqual([
      'tokens.consume',
      'users.applyPasswordReset',
      'mailer.sendPasswordResetCompleted',
    ]);
  });

  test('漏洩の照合を省いたときも完了する', async () => {
    const { passwordReset, recorded } = setup({
      validation: { ok: true, pwnedCheck: 'skipped' },
    });

    await passwordReset.complete(COMPLETE_INPUT, META);

    expect(recorded.applied).toHaveLength(1);
  });

  test.each([
    ['存在しない', []],
    ['期限切れの', [{ ...RESET_TOKEN, expiresAt: new Date(NOW.getTime()) }]],
    ['ほかの用途の', [{ ...RESET_TOKEN, purpose: 'password_change' as const }]],
  ] as const)(
    '%sトークンは422のinvalid_linkで拒否し、利用者を読まず何も更新しない',
    async (_label, tokens) => {
      const { passwordReset, recorded } = setup({ tokens: [...tokens] });

      const error = await caught(passwordReset.complete(COMPLETE_INPUT, META));

      expect(shapeOf(error)).toEqual(INVALID_LINK);
      expect(recorded.calls).toEqual(['secrets.hashOf', 'tokens.findValid']);
    },
  );

  test.each(NOT_TARGETS)(
    '%sの利用者のトークンはinvalid_linkで拒否し、方針の確認もトークンの消費も更新もしない',
    async (_label, user) => {
      const { passwordReset, recorded, stored } = setup({ user });

      const error = await caught(passwordReset.complete(COMPLETE_INPUT, META));

      expect(shapeOf(error)).toEqual(INVALID_LINK);
      expect(recorded.calls).toEqual([
        'secrets.hashOf',
        'tokens.findValid',
        'users.findById',
      ]);
      expect(stored).toEqual([RESET_TOKEN]);
    },
  );

  test.each([
    [
      { ok: false, violation: 'pwned' },
      'pwned',
      'このパスワードは過去に漏洩したことがあります。別のパスワードを設定してください。',
    ],
    [
      { ok: false, violation: 'matches-identity' },
      'matches_identity',
      'ハンドル・ニックネーム・メールアドレスと同じパスワードは使えません。',
    ],
    [
      { ok: false, violation: 'too-short' },
      'too_short',
      'パスワードは8文字以上128文字以内で入力してください。',
    ],
    [
      { ok: false, violation: 'too-long' },
      'too_long',
      'パスワードは8文字以上128文字以内で入力してください。',
    ],
  ] as const)(
    'パスワードの方針の違反(%o)は422とpassword_rejectedで欄newPasswordの詳細を付けて拒否し、トークンを消費しない',
    async (validation, detailCode, message) => {
      const { passwordReset, recorded, stored } = setup({ validation });

      const error = await caught(passwordReset.complete(COMPLETE_INPUT, META));

      expect(error.kind).toBe('unprocessable');
      expect(error.code).toBe('password_rejected');
      expect(error.message).toBe(message);
      expect(error.details).toEqual([
        { field: 'newPassword', code: detailCode, message },
      ]);
      expect(recorded.passwordHashes).toEqual([]);
      expect(recorded.calls).not.toContain('tokens.consume');
      expect(recorded.applied).toEqual([]);
      expect(recorded.completedMails).toEqual([]);
      expect(stored).toEqual([RESET_TOKEN]);
    },
  );

  test('方針に反した後も同じリンクで、方針を満たすパスワードに再設定できる', async () => {
    const rejected = setup({
      validation: { ok: false, violation: 'pwned' },
    });
    await caught(rejected.passwordReset.complete(COMPLETE_INPUT, META));

    const retried = setup({ tokens: rejected.stored });
    await retried.passwordReset.complete(COMPLETE_INPUT, META);

    expect(retried.recorded.applied).toHaveLength(1);
  });

  test('同時の確定に負けてトークンを消費できなければinvalid_linkで拒否し、パスワードを更新せずメールを送らない', async () => {
    const { passwordReset, recorded } = setup({ consumedConcurrently: true });

    const error = await caught(passwordReset.complete(COMPLETE_INPUT, META));

    expect(shapeOf(error)).toEqual(INVALID_LINK);
    expect(recorded.applied).toEqual([]);
    expect(recorded.completedMails).toEqual([]);
  });

  test('2回目の確定は使用済みのトークンとしてinvalid_linkで拒否する', async () => {
    const { passwordReset, recorded } = setup();
    await passwordReset.complete(COMPLETE_INPUT, META);

    const error = await caught(passwordReset.complete(COMPLETE_INPUT, META));

    expect(shapeOf(error)).toEqual(INVALID_LINK);
    expect(recorded.applied).toHaveLength(1);
  });

  test('完了メールの送信要求に失敗しても、パスワードの更新は完了しているため成功を返す', async () => {
    const { passwordReset, recorded } = setup({
      mailError: new Error('送信の受付に失敗しました'),
    });

    await passwordReset.complete(COMPLETE_INPUT, META);

    expect(recorded.applied).toHaveLength(1);
    expect(recorded.completedMails).toHaveLength(1);
  });

  test('パスワードの更新に失敗したら、例外をそのまま投げて完了メールを送らない', async () => {
    const applyError = new Error('D1の書き込みに失敗しました');
    const { passwordReset, recorded } = setup({ applyError });

    const rejection: unknown = await passwordReset
      .complete(COMPLETE_INPUT, META)
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(rejection).toBe(applyError);
    expect(recorded.completedMails).toEqual([]);
  });
});
