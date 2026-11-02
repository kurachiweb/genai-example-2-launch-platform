import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';
import { Container } from 'inversify';

import type { HashPurpose } from '../../../lib/core/crypto/keyed-hasher.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import type { PasswordIdentifiers } from '../../domain/auth/password-rules.ts';
import { USER_SESSION_POLICY } from '../../domain/auth/session-policy.ts';
import {
  GENERATED_HANDLE_ALPHABET,
  GENERATED_HANDLE_LENGTH,
} from '../../domain/identity/handle.ts';
import { AUTH_TYPES } from '../auth/auth-types.ts';
import type {
  NewPasswordValidation,
  PasswordPolicy,
} from '../auth/password-policy.ts';
import type { PasswordHasher, SecretGenerator } from '../auth/ports.ts';
import type { SecretIssuer } from '../auth/secret-issuer.ts';
import { IDENTITY_TYPES } from './identity-types.ts';
import type {
  HandleAvailability,
  IdentityMailer,
  LimitedMailKind,
  MailSendLimits,
  NewAuthToken,
  NewSessionRecord,
  NewUserRecord,
  UserAccountStore,
  UserRecord,
} from './ports.ts';
import {
  HANDLE_GENERATION_ATTEMPTS,
  type Registration,
  type RegisterUserCommand,
  StoreRegistration,
} from './registration.ts';
import type { RequestMeta } from './request-meta.ts';

const NOW = new Date('2026-11-02T03:04:05.678Z');

const HOUR_MS = 60 * 60 * 1000;

const SECONDS_PER_DAY = 24 * 60 * 60;

const PSEUDONYMOUS_ID = '0b9c6f0e-6a55-4a1f-9d4e-2f3c5b7a8d91';

const PASSWORD = ['correct', 'horse', 'battery', 'staple'].join(' ');

const COMMAND: RegisterUserCommand = {
  nickname: 'やまだ たろう',
  email: 'Taro.Yamada@mail.example',
  password: PASSWORD,
  agreedToTerms: true,
};

const META: RequestMeta = {
  clientIp: '192.0.2.10',
  userAgent: 'Mozilla/5.0',
  now: NOW,
};

type CreateResult = 'created' | 'email-in-use' | 'handle-in-use';

interface CreateCall {
  readonly user: NewUserRecord;
  readonly token: NewAuthToken;
  readonly session: NewSessionRecord;
}

interface MailCall {
  readonly to: UserRecord;
  readonly token: string;
  readonly expiresAt: Date;
}

interface FakeOptions {
  readonly limitError?: Error;
  readonly emailInUse?: boolean;
  readonly handles?: readonly string[];
  readonly unavailableHandles?: readonly string[];
  readonly validation?: NewPasswordValidation;
  readonly createResults?: readonly CreateResult[];
  readonly mailError?: Error;
}

interface Recorded {
  readonly calls: string[];
  readonly limits: {
    readonly kind: LimitedMailKind;
    readonly address: string;
    readonly meta: RequestMeta;
  }[];
  readonly emailChecks: string[];
  readonly randomStrings: {
    readonly length: number;
    readonly alphabet: string;
  }[];
  readonly availabilityChecks: string[];
  readonly policyChecks: {
    readonly password: string;
    readonly identifiers: PasswordIdentifiers;
  }[];
  readonly hashed: string[];
  readonly creates: CreateCall[];
  readonly mails: MailCall[];
  readonly issuedSecrets: {
    readonly purpose: string;
    readonly plain: string;
  }[];
}

const notUsed = (): never => {
  throw new Error('登録では使わない');
};

function createFakes(options: FakeOptions = {}) {
  const recorded: Recorded = {
    calls: [],
    limits: [],
    emailChecks: [],
    randomStrings: [],
    availabilityChecks: [],
    policyChecks: [],
    hashed: [],
    creates: [],
    mails: [],
    issuedSecrets: [],
  };
  const handles = [...(options.handles ?? ['handle000001', 'handle000002'])];
  const createResults = [...(options.createResults ?? ['created'])];
  const unavailable = new Set(options.unavailableHandles ?? []);

  const limits: MailSendLimits = {
    consume(kind, address, meta) {
      recorded.calls.push('limits.consume');
      recorded.limits.push({ kind, address, meta });
      return options.limitError === undefined
        ? Promise.resolve()
        : Promise.reject(options.limitError);
    },
  };

  const users: UserAccountStore = {
    findById: notUsed,
    findNotWithdrawnByEmail: notUsed,
    isEmailInUse(email) {
      recorded.calls.push('users.isEmailInUse');
      recorded.emailChecks.push(email);
      return Promise.resolve(options.emailInUse ?? false);
    },
    createWithVerification(user, token, session) {
      recorded.calls.push('users.createWithVerification');
      recorded.creates.push({ user, token, session });
      return Promise.resolve(createResults.shift() ?? 'created');
    },
    markEmailVerified: notUsed,
    saveDisposableStatus: notUsed,
    applyPasswordReset: notUsed,
    applyEmailChange: notUsed,
    applyPasswordChange: notUsed,
    listUndetermined: notUsed,
  };

  const handleAvailability: HandleAvailability = {
    isAvailable(handle) {
      recorded.calls.push('handles.isAvailable');
      recorded.availabilityChecks.push(handle);
      return Promise.resolve(!unavailable.has(handle));
    },
  };

  let generated = 0;
  const generator: SecretGenerator = {
    token: notUsed,
    randomString(length, alphabet) {
      recorded.calls.push('generator.randomString');
      recorded.randomStrings.push({ length, alphabet });
      generated += 1;
      return (
        handles.shift() ?? `generated${String(generated).padStart(3, '0')}`
      );
    },
    uuid: () => PSEUDONYMOUS_ID,
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

  const hasher: PasswordHasher = {
    hash(password) {
      recorded.calls.push('hasher.hash');
      recorded.hashed.push(password);
      return Promise.resolve('pbkdf2-sha512$100000$salt$derived');
    },
    verify: notUsed,
    verifyAgainstDummy: notUsed,
  };

  let issuedCount = 0;
  const secrets: SecretIssuer = {
    issue(purpose: HashPurpose) {
      issuedCount += 1;
      const plain = `plain-secret-${String(issuedCount)}`;
      recorded.issuedSecrets.push({ purpose, plain });
      return Promise.resolve({ plain, hash: `hashed(${purpose}):${plain}` });
    },
    hashOf: notUsed,
  };

  let sequence = 0;
  const ids: IdGenerator = {
    generate: () => `01JREGISTER${String(sequence++).padStart(15, '0')}`,
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

  return {
    recorded,
    limits,
    users,
    handleAvailability,
    generator,
    policy,
    hasher,
    secrets,
    ids,
    mailer,
  };
}

type Fakes = ReturnType<typeof createFakes>;

function createRegistration(fakes: Fakes): Registration {
  return new StoreRegistration(
    fakes.limits,
    fakes.users,
    fakes.handleAvailability,
    fakes.generator,
    fakes.policy,
    fakes.hasher,
    fakes.secrets,
    fakes.ids,
    fakes.mailer,
  );
}

function setup(options: FakeOptions = {}) {
  const fakes = createFakes(options);
  return {
    fakes,
    recorded: fakes.recorded,
    registration: createRegistration(fakes),
  };
}

function issuedPlain(recorded: Recorded, purpose: string): string {
  const secret = recorded.issuedSecrets.find(
    (issued) => issued.purpose === purpose,
  );
  if (secret === undefined) {
    throw new Error(`用途${purpose}の秘密が発行されていません。`);
  }
  return secret.plain;
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

async function caughtAny(action: Promise<unknown>): Promise<unknown> {
  try {
    await action;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('例外が発生しませんでした。');
}

const records: LogRecord[] = [];

beforeEach(() => {
  records.length = 0;
  configureSync({
    reset: true,
    sinks: {
      capture: (record) => {
        records.push(record);
      },
    },
    loggers: [
      { category: ['api'], sinks: ['capture'], lowestLevel: 'debug' },
      { category: ['logtape', 'meta'], sinks: [], lowestLevel: 'warning' },
    ],
  });
});

afterEach(() => {
  resetSync();
});

describe('StoreRegistration.register', () => {
  test('送信回数→重複→ハンドル→パスワードの方針→ハッシュ化→保存→確認メールの順に進む', async () => {
    const { registration, recorded } = setup();

    await registration.register(COMMAND, META);

    expect(recorded.calls).toEqual([
      'limits.consume',
      'users.isEmailInUse',
      'generator.randomString',
      'handles.isAvailable',
      'policy.validateNewPassword',
      'hasher.hash',
      'users.createWithVerification',
      'mailer.sendEmailVerification',
    ]);
  });

  test('アカウントや重複の有無を判定する前に、確認メールの送信回数を宛先と要求の情報で数える', async () => {
    const { registration, recorded } = setup({ emailInUse: true });

    await caught(registration.register(COMMAND, META));

    expect(recorded.limits).toEqual([
      { kind: 'email_verification', address: COMMAND.email, meta: META },
    ]);
    expect(recorded.calls.indexOf('limits.consume')).toBeLessThan(
      recorded.calls.indexOf('users.isEmailInUse'),
    );
  });

  test('送信回数が上限なら、その例外をそのまま投げて利用者を作らない', async () => {
    const limitError = new AppError({
      kind: 'rate_limited',
      code: 'rate_limit_exceeded',
      message: '操作が集中しています。しばらく待ってから再度お試しください。',
      retryAfterSeconds: 1200,
    });
    const { registration, recorded } = setup({ limitError });

    const error = await caught(registration.register(COMMAND, META));

    expect(error).toBe(limitError);
    expect(recorded.calls).toEqual(['limits.consume']);
    expect(recorded.creates).toEqual([]);
    expect(recorded.mails).toEqual([]);
  });

  test('未退会の利用者とメールアドレスが重複すれば、409とregistration_email_unavailableで拒否する', async () => {
    const { registration, recorded } = setup({ emailInUse: true });

    const error = await caught(registration.register(COMMAND, META));

    expect(error.kind).toBe('conflict');
    expect(error.code).toBe('registration_email_unavailable');
    expect(error.message).toBe('このメールアドレスは登録できません。');
    expect(recorded.emailChecks).toEqual([COMMAND.email]);
    expect(recorded.policyChecks).toEqual([]);
    expect(recorded.creates).toEqual([]);
    expect(recorded.mails).toEqual([]);
  });

  test('保存の時点でメールアドレスが重複していても、registration_email_unavailableで拒否してメールを送らない', async () => {
    const { registration, recorded } = setup({
      createResults: ['email-in-use'],
    });

    const error = await caught(registration.register(COMMAND, META));

    expect(error.code).toBe('registration_email_unavailable');
    expect(recorded.creates).toHaveLength(1);
    expect(recorded.mails).toEqual([]);
  });

  test('ハンドルは英小文字と数字の12文字で生成し、使われていれば作り直す', async () => {
    const { registration, recorded } = setup({
      handles: ['takenhandle1', 'takenhandle2', 'freehandle01'],
      unavailableHandles: ['takenhandle1', 'takenhandle2'],
    });

    await registration.register(COMMAND, META);

    expect(recorded.randomStrings).toEqual(
      Array.from({ length: 3 }, () => ({
        length: GENERATED_HANDLE_LENGTH,
        alphabet: GENERATED_HANDLE_ALPHABET,
      })),
    );
    expect(recorded.availabilityChecks).toEqual([
      'takenhandle1',
      'takenhandle2',
      'freehandle01',
    ]);
    expect(recorded.creates[0]?.user.handle).toBe('freehandle01');
  });

  test('同時の作成でハンドルが衝突したら、新しいハンドルで作り直す', async () => {
    const { registration, recorded } = setup({
      handles: ['firsthandle1', 'secondhandl2'],
      createResults: ['handle-in-use', 'created'],
    });

    const result = await registration.register(COMMAND, META);

    expect(recorded.creates.map(({ user }) => user.handle)).toEqual([
      'firsthandle1',
      'secondhandl2',
    ]);
    expect(recorded.availabilityChecks).toEqual([
      'firsthandle1',
      'secondhandl2',
    ]);
    expect(recorded.creates[1]?.user.id).toBe(result.userId);
    expect(recorded.hashed).toHaveLength(1);
    expect(recorded.mails).toHaveLength(1);
    expect(recorded.mails[0]?.to.handle).toBe('secondhandl2');
  });

  test(`ハンドルの候補は事前の確認と保存の衝突を合わせて${String(HANDLE_GENERATION_ATTEMPTS)}回までで、使い切れば作らずに失敗する`, async () => {
    const { registration, recorded } = setup({
      handles: [
        'candidate001',
        'candidate002',
        'candidate003',
        'candidate004',
        'candidate005',
        'candidate006',
      ],
      unavailableHandles: ['candidate001', 'candidate002'],
      createResults: ['handle-in-use', 'handle-in-use', 'handle-in-use'],
    });

    const error = await caughtAny(registration.register(COMMAND, META));

    expect(HANDLE_GENERATION_ATTEMPTS).toBe(5);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(AppError);
    expect(recorded.randomStrings).toHaveLength(5);
    expect(recorded.creates).toHaveLength(3);
    expect(recorded.mails).toEqual([]);
  });

  test('すべてのハンドルの候補が使われていれば、パスワードの方針を確かめずに失敗する', async () => {
    const taken = Array.from(
      { length: 5 },
      (_, index) => `takenhandle${String(index)}`,
    );
    const { registration, recorded } = setup({
      handles: taken,
      unavailableHandles: taken,
    });

    const error = await caughtAny(registration.register(COMMAND, META));

    expect(error).not.toBeInstanceOf(AppError);
    expect(recorded.availabilityChecks).toEqual(taken);
    expect(recorded.policyChecks).toEqual([]);
    expect(recorded.creates).toEqual([]);
  });

  test('パスワードの方針はハンドル・ニックネーム・メールアドレスを識別子として確かめる', async () => {
    const { registration, recorded } = setup({ handles: ['abcdefghijkl'] });

    await registration.register(COMMAND, META);

    expect(recorded.policyChecks).toEqual([
      {
        password: PASSWORD,
        identifiers: {
          handle: 'abcdefghijkl',
          nickname: COMMAND.nickname,
          email: COMMAND.email,
        },
      },
    ]);
    expect(recorded.hashed).toEqual([PASSWORD]);
  });

  test.each<[NewPasswordValidation & { ok: false }, string, string]>([
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
  ])(
    'パスワードの方針の違反(%o)は422とpassword_rejectedで、欄passwordの詳細を付けて拒否する',
    async (validation, detailCode, message) => {
      const { registration, recorded } = setup({ validation });

      const error = await caught(registration.register(COMMAND, META));

      expect(error.kind).toBe('unprocessable');
      expect(error.code).toBe('password_rejected');
      expect(error.message).toBe(message);
      expect(error.details).toEqual([
        { field: 'password', code: detailCode, message },
      ]);
      expect(recorded.hashed).toEqual([]);
      expect(recorded.creates).toEqual([]);
      expect(recorded.mails).toEqual([]);
    },
  );

  test('漏洩の照合を省いたときも登録を続ける', async () => {
    const { registration, recorded } = setup({
      validation: { ok: true, pwnedCheck: 'skipped' },
    });

    await registration.register(COMMAND, META);

    expect(recorded.creates).toHaveLength(1);
  });

  test('未確認の利用者を、仮名化ID・前後の空白を除いた入力・パスワードのハッシュ・同意の日時とともに保存する', async () => {
    const { registration, recorded } = setup({ handles: ['abcdefghijkl'] });

    const result = await registration.register(
      {
        ...COMMAND,
        nickname: '　やまだ たろう ',
        email: ` ${COMMAND.email}\t`,
      },
      META,
    );

    expect(recorded.creates[0]?.user).toEqual({
      id: result.userId,
      pseudonymousId: PSEUDONYMOUS_ID,
      email: COMMAND.email,
      passwordHash: 'pbkdf2-sha512$100000$salt$derived',
      nickname: 'やまだ たろう',
      handle: 'abcdefghijkl',
      termsAgreedAt: NOW,
    });
    expect(recorded.limits[0]?.address).toBe(COMMAND.email);
    expect(recorded.emailChecks).toEqual([COMMAND.email]);
    expect(recorded.policyChecks[0]?.identifiers).toEqual({
      handle: 'abcdefghijkl',
      nickname: 'やまだ たろう',
      email: COMMAND.email,
    });
  });

  test('有効期限24時間の確認のトークンを、用途ごとのハッシュだけで同じ一括の書き込みに含める', async () => {
    const { registration, recorded } = setup();

    const result = await registration.register(COMMAND, META);

    const verificationPlain = issuedPlain(
      recorded,
      'user-auth-token-email-verification',
    );
    expect(recorded.creates[0]?.token).toEqual({
      userId: result.userId,
      purpose: 'email_verification',
      tokenHash: `hashed(user-auth-token-email-verification):${verificationPlain}`,
      expiresAt: new Date(NOW.getTime() + 24 * HOUR_MS),
    });
  });

  test('その端末のセッションを同じ一括の書き込みに含め、平文のトークンと有効期間を返す', async () => {
    const { registration, recorded } = setup();

    const result = await registration.register(COMMAND, META);

    const sessionPlain = issuedPlain(recorded, 'user-session');
    expect(recorded.creates[0]?.session).toEqual({
      id: result.session.sessionId,
      userId: result.userId,
      tokenHash: `hashed(user-session):${sessionPlain}`,
      userAgent: 'Mozilla/5.0',
      createdAt: NOW,
      lastUsedAt: NOW,
      absoluteExpiresAt: new Date(
        NOW.getTime() + USER_SESSION_POLICY.absoluteSeconds * 1000,
      ),
    });
    expect(result.session.token).toBe(sessionPlain);
    expect(result.session.maxAgeSeconds).toBe(14 * SECONDS_PER_DAY);
    expect(result.userId).not.toBe(result.session.sessionId);
  });

  test('作成した利用者へ、確認のトークンの平文と有効期限で確認メールを送る', async () => {
    const { registration, recorded } = setup({ handles: ['abcdefghijkl'] });

    const result = await registration.register(COMMAND, META);

    const verificationPlain = issuedPlain(
      recorded,
      'user-auth-token-email-verification',
    );
    expect(recorded.mails).toEqual([
      {
        to: {
          id: result.userId,
          status: 'active',
          emailVerifiedAt: null,
          deletedAt: null,
          pseudonymousId: PSEUDONYMOUS_ID,
          email: COMMAND.email,
          passwordHash: 'pbkdf2-sha512$100000$salt$derived',
          nickname: COMMAND.nickname,
          handle: 'abcdefghijkl',
          disposableEmailStatus: null,
          termsAgreedAt: NOW,
          lifecycleVersion: 0,
        },
        token: verificationPlain,
        expiresAt: new Date(NOW.getTime() + 24 * HOUR_MS),
      },
    ]);
  });

  test('確認メールの送信要求に失敗しても、errorのログに留めて登録とログインを完了する', async () => {
    const { registration, recorded } = setup({
      mailError: new Error('送信の受付に失敗しました'),
    });

    const result = await registration.register(COMMAND, META);

    expect(result.session.token).toBeDefined();
    const errors = records.filter(
      (record) =>
        record.category.join('.') === 'api.identity.registration' &&
        record.level === 'error',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.properties).toMatchObject({ userId: result.userId });
    expect(errors[0]?.properties['error']).toBeInstanceOf(Error);
    const serialized = JSON.stringify(errors[0]?.properties);
    expect(serialized).not.toContain(COMMAND.email);
    expect(serialized).not.toContain(recorded.mails[0]?.token ?? '-');
  });

  test('コンテナで依存を注入して解決できる', async () => {
    const fakes = createFakes();
    const container = new Container();
    container
      .bind<MailSendLimits>(IDENTITY_TYPES.MailSendLimits)
      .toConstantValue(fakes.limits);
    container
      .bind<UserAccountStore>(IDENTITY_TYPES.UserAccountStore)
      .toConstantValue(fakes.users);
    container
      .bind<HandleAvailability>(IDENTITY_TYPES.HandleAvailability)
      .toConstantValue(fakes.handleAvailability);
    container
      .bind<SecretGenerator>(AUTH_TYPES.SecretGenerator)
      .toConstantValue(fakes.generator);
    container
      .bind<PasswordPolicy>(AUTH_TYPES.PasswordPolicy)
      .toConstantValue(fakes.policy);
    container
      .bind<PasswordHasher>(AUTH_TYPES.PasswordHasher)
      .toConstantValue(fakes.hasher);
    container
      .bind<SecretIssuer>(AUTH_TYPES.SecretIssuer)
      .toConstantValue(fakes.secrets);
    container
      .bind<IdGenerator>(PLATFORM_TYPES.IdGenerator)
      .toConstantValue(fakes.ids);
    container
      .bind<IdentityMailer>(IDENTITY_TYPES.IdentityMailer)
      .toConstantValue(fakes.mailer);
    container
      .bind<Registration>(IDENTITY_TYPES.Registration)
      .to(StoreRegistration);

    const registration = container.get<Registration>(
      IDENTITY_TYPES.Registration,
    );
    await registration.register(COMMAND, META);

    expect(fakes.recorded.creates).toHaveLength(1);
  });
});
