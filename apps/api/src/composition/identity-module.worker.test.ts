import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { type Container, ContainerModule } from 'inversify';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { createKeyedHasher } from '../../lib/core/crypto/keyed-hasher.ts';
import type { DisposableEmailChecker } from '../../lib/core/identity/disposable-email.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../lib/core/identity/identifiers.ts';
import type { UserLifecycleStore } from '../../lib/core/identity/ports.ts';
import { hashRateLimitKey } from '../../lib/core/rate-limit/rate-limit-key.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  clearIdentityTables,
  insertUser,
  T0,
  userIdOf,
} from '../../lib/workers/identity/testing/identity-store-fixtures.ts';
import { AUTH_TYPES } from '../application/auth/auth-types.ts';
import { CheckingPasswordPolicy } from '../application/auth/password-policy.ts';
import type {
  LoginThrottle,
  PwnedPasswordChecker,
} from '../application/auth/ports.ts';
import { HashingRecoveryCodeIssuer } from '../application/auth/recovery-code-issuer.ts';
import { HashingSecretIssuer } from '../application/auth/secret-issuer.ts';
import { SubjectSessionVerifier } from '../application/auth/subject-session-verifier.ts';
import { StoreAccountGuard } from '../application/identity/account-guard.ts';
import { AccountUploaderEligibility } from '../application/identity/account-uploader-eligibility.ts';
import {
  ADMINISTRATIVE_CALLER,
  StoreAdministrativeWithdrawal,
} from '../application/identity/administrative-withdrawal.ts';
import { SavingDisposableEmailCheck } from '../application/identity/disposable-email-check.ts';
import { StoreEmailChange } from '../application/identity/email-change.ts';
import { StoreEmailVerification } from '../application/identity/email-verification.ts';
import { IDENTITY_TYPES } from '../application/identity/identity-types.ts';
import { CredentialCleanupJob } from '../application/identity/jobs/credential-cleanup-job.ts';
import { DisposableRecheckSweepJob } from '../application/identity/jobs/disposable-recheck-sweep-job.ts';
import { LifecycleRedispatchJob } from '../application/identity/jobs/lifecycle-redispatch-job.ts';
import { PurgeOrchestratorJob } from '../application/identity/jobs/purge-orchestrator-job.ts';
import { StoreLogin } from '../application/identity/login.ts';
import { StorePasswordChange } from '../application/identity/password-change.ts';
import { StorePasswordReset } from '../application/identity/password-reset.ts';
import type {
  HandleAvailability,
  IdentitySettings,
  UserLifecycleCommitter,
} from '../application/identity/ports.ts';
import { StoreReAuthenticator } from '../application/identity/re-authenticator.ts';
import { StoreRegistration } from '../application/identity/registration.ts';
import {
  type SessionIssuer,
  SESSION_USER_AGENT_MAX_LENGTH,
  StoreSessionIssuer,
} from '../application/identity/session-issuer.ts';
import { StoreSessionManagement } from '../application/identity/session-management.ts';
import { StoreTotpManagement } from '../application/identity/totp-management.ts';
import { UserSessionVerifier } from '../application/identity/user-session-verifier.ts';
import { StoreUserSuspension } from '../application/identity/user-suspension.ts';
import { StoreWithdrawal } from '../application/identity/withdrawal.ts';
import { PROFILE_TYPES } from '../application/profile/profile-types.ts';
import { UserHandleAvailability } from '../application/profile/user-handle-availability.ts';
import { SESSION_TYPES } from '../application/session/session-verifier.ts';
import { CryptoSecretGenerator } from '../infrastructure/auth/crypto-secret-generator.ts';
import { HibpPwnedPasswordChecker } from '../infrastructure/auth/hibp-pwned-password-checker.ts';
import { HkdfAesGcmSecretBox } from '../infrastructure/auth/hkdf-aes-gcm-secret-box.ts';
import { OtpauthTotpAuthenticator } from '../infrastructure/auth/otpauth-totp-authenticator.ts';
import { Pbkdf2PasswordHasher } from '../infrastructure/auth/pbkdf2-password-hasher.ts';
import { SentryAuthIncidentReporter } from '../infrastructure/auth/sentry-auth-incident-reporter.ts';
import { BowserDeviceDescriber } from '../infrastructure/identity/bowser-device-describer.ts';
import { CounterMailSendLimits } from '../infrastructure/identity/counter-mail-send-limits.ts';
import { D1AuthTokenStore } from '../infrastructure/identity/d1-auth-token-store.ts';
import { D1LoginChallengeStore } from '../infrastructure/identity/d1-login-challenge-store.ts';
import { D1RecoveryCodeStore } from '../infrastructure/identity/d1-recovery-code-store.ts';
import { D1TotpCredentialStore } from '../infrastructure/identity/d1-totp-credential-store.ts';
import { D1UserAccountStore } from '../infrastructure/identity/d1-user-account-store.ts';
import { D1UserSessionStore } from '../infrastructure/identity/d1-user-session-store.ts';
import { EmailIdentityMailer } from '../infrastructure/identity/email-identity-mailer.ts';
import {
  CALLER_KINDS,
  SESSION_RESPONSE_HEADERS,
} from '../presentation/gateway/gateway-headers.ts';
import {
  applySessionInstructions,
  createSessionAccess,
} from '../presentation/gateway/session-access.ts';
import { USER_AGENT_MAX_LENGTH } from '../presentation/graphql/graphql-module.ts';
import { apiEnvSchema } from './env-schema.ts';
import { createIdentityModule, IDENTITY_MODULE } from './identity-module.ts';
import { HANDLE_AVAILABILITY } from './identity-registrations.ts';
import { MODULES } from './modules.ts';

type TestEnv = typeof env;

function createContainer(overrides: Partial<TestEnv> = {}): Container {
  return createInvocationContainer(
    {
      env: { ...env, ...overrides },
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    MODULES,
  );
}

const CLASS_BINDINGS: readonly (readonly [
  string,
  symbol,
  abstract new (...args: never[]) => unknown,
])[] = [
  ['PasswordHasher', AUTH_TYPES.PasswordHasher, Pbkdf2PasswordHasher],
  [
    'PwnedPasswordChecker',
    AUTH_TYPES.PwnedPasswordChecker,
    HibpPwnedPasswordChecker,
  ],
  ['PasswordPolicy', AUTH_TYPES.PasswordPolicy, CheckingPasswordPolicy],
  ['SecretGenerator', AUTH_TYPES.SecretGenerator, CryptoSecretGenerator],
  ['SecretIssuer', AUTH_TYPES.SecretIssuer, HashingSecretIssuer],
  ['SecretBox', AUTH_TYPES.SecretBox, HkdfAesGcmSecretBox],
  ['TotpAuthenticator', AUTH_TYPES.TotpAuthenticator, OtpauthTotpAuthenticator],
  [
    'RecoveryCodeIssuer',
    AUTH_TYPES.RecoveryCodeIssuer,
    HashingRecoveryCodeIssuer,
  ],
  [
    'AuthIncidentReporter',
    AUTH_TYPES.AuthIncidentReporter,
    SentryAuthIncidentReporter,
  ],
  ['UserSessionVerifier', AUTH_TYPES.UserSessionVerifier, UserSessionVerifier],
  ['UserAccountStore', IDENTITY_TYPES.UserAccountStore, D1UserAccountStore],
  ['UserSessionStore', IDENTITY_TYPES.UserSessionStore, D1UserSessionStore],
  ['AuthTokenStore', IDENTITY_TYPES.AuthTokenStore, D1AuthTokenStore],
  [
    'LoginChallengeStore',
    IDENTITY_TYPES.LoginChallengeStore,
    D1LoginChallengeStore,
  ],
  [
    'TotpCredentialStore',
    IDENTITY_TYPES.TotpCredentialStore,
    D1TotpCredentialStore,
  ],
  ['RecoveryCodeStore', IDENTITY_TYPES.RecoveryCodeStore, D1RecoveryCodeStore],
  [
    'HandleAvailability',
    IDENTITY_TYPES.HandleAvailability,
    UserHandleAvailability,
  ],
  ['DeviceDescriber', IDENTITY_TYPES.DeviceDescriber, BowserDeviceDescriber],
  ['IdentityMailer', IDENTITY_TYPES.IdentityMailer, EmailIdentityMailer],
  ['SessionIssuer', IDENTITY_TYPES.SessionIssuer, StoreSessionIssuer],
  ['AccountGuard', IDENTITY_PLATFORM_TYPES.AccountGuard, StoreAccountGuard],
  ['MailSendLimits', IDENTITY_TYPES.MailSendLimits, CounterMailSendLimits],
  ['Registration', IDENTITY_TYPES.Registration, StoreRegistration],
  [
    'EmailVerification',
    IDENTITY_TYPES.EmailVerification,
    StoreEmailVerification,
  ],
  [
    'DisposableEmailCheck',
    IDENTITY_TYPES.DisposableEmailCheck,
    SavingDisposableEmailCheck,
  ],
  ['Login', IDENTITY_TYPES.Login, StoreLogin],
  ['ReAuthenticator', IDENTITY_TYPES.ReAuthenticator, StoreReAuthenticator],
  [
    'SessionManagement',
    IDENTITY_TYPES.SessionManagement,
    StoreSessionManagement,
  ],
  ['PasswordReset', IDENTITY_TYPES.PasswordReset, StorePasswordReset],
  ['EmailChange', IDENTITY_TYPES.EmailChange, StoreEmailChange],
  ['PasswordChange', IDENTITY_TYPES.PasswordChange, StorePasswordChange],
  ['TotpManagement', IDENTITY_TYPES.TotpManagement, StoreTotpManagement],
  ['Withdrawal', IDENTITY_TYPES.Withdrawal, StoreWithdrawal],
  [
    'AdministrativeWithdrawal',
    IDENTITY_TYPES.AdministrativeWithdrawal,
    StoreAdministrativeWithdrawal,
  ],
  ['UserSuspension', IDENTITY_TYPES.UserSuspension, StoreUserSuspension],
  [
    'AccountUploaderEligibility',
    IDENTITY_TYPES.AccountUploaderEligibility,
    AccountUploaderEligibility,
  ],
  [
    'PurgeOrchestratorJob',
    IDENTITY_TYPES.PurgeOrchestratorJob,
    PurgeOrchestratorJob,
  ],
  [
    'LifecycleRedispatchJob',
    IDENTITY_TYPES.LifecycleRedispatchJob,
    LifecycleRedispatchJob,
  ],
  [
    'CredentialCleanupJob',
    IDENTITY_TYPES.CredentialCleanupJob,
    CredentialCleanupJob,
  ],
  [
    'DisposableRecheckSweepJob',
    IDENTITY_TYPES.DisposableRecheckSweepJob,
    DisposableRecheckSweepJob,
  ],
];

interface RecordedRequest {
  readonly url: string;
  readonly headers: Headers;
}

function recordFetch(): RecordedRequest[] {
  const requests: RecordedRequest[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    requests.push({
      url: input instanceof Request ? input.url : String(input),
      headers: new Headers(init?.headers),
    });
    return Promise.resolve(new Response('', { status: 503 }));
  });
  return requests;
}

beforeEach(async () => {
  await clearIdentityTables();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('APIサーバーの認証部品と利用者のモジュールの束縛', () => {
  test.each(CLASS_BINDINGS)(
    '処理単位のコンテナから%sを解決する',
    (_name, identifier, implementation) => {
      expect(createContainer().get(identifier)).toBeInstanceOf(implementation);
    },
  );

  test('ハンドルの重複判定は、登録箇所の識別子を経由してプロフィールのUserHandleAvailabilityに解決する', () => {
    expect(HANDLE_AVAILABILITY).toBe(PROFILE_TYPES.UserHandleAvailability);
    expect(
      createContainer().get(IDENTITY_TYPES.HandleAvailability),
    ).toBeInstanceOf(UserHandleAvailability);
  });

  test('ハンドルの重複判定は、登録箇所の識別子に束縛した実装へ転送する', async () => {
    const replacement = Symbol.for('test.HandleAvailability');
    const fake: HandleAvailability = {
      isAvailable: () => Promise.resolve(false),
    };
    const container = createInvocationContainer(
      {
        env,
        executionCtx: createExecutionContext(),
        info: {
          kind: 'fetch',
          correlationId: crypto.randomUUID(),
          clientIp: undefined,
        },
      },
      [
        ...MODULES.filter(({ name }) => name !== IDENTITY_MODULE.name),
        createIdentityModule({ handleAvailability: replacement }),
        {
          bindings: new ContainerModule(({ bind }) => {
            bind<HandleAvailability>(replacement).toConstantValue(fake);
          }),
        },
      ],
    );

    const availability = container.get<HandleAvailability>(
      IDENTITY_TYPES.HandleAvailability,
    );

    expect(availability).toBe(fake);
    await expect(availability.isAvailable('user1')).resolves.toBe(false);
  });

  test('機能制限の判定は処理単位の中で1つを使い回し、別の処理単位では別のインスタンスになる', () => {
    const container = createContainer();

    expect(container.get(IDENTITY_PLATFORM_TYPES.AccountGuard)).toBe(
      container.get(IDENTITY_PLATFORM_TYPES.AccountGuard),
    );
    expect(container.get(IDENTITY_PLATFORM_TYPES.AccountGuard)).not.toBe(
      createContainer().get(IDENTITY_PLATFORM_TYPES.AccountGuard),
    );
  });

  test('利用者の状態の遷移を、空の同期の波及処理の登録でD1へ確定する', async () => {
    await insertUser(1);
    const committer = createContainer().get<UserLifecycleCommitter>(
      IDENTITY_TYPES.UserLifecycleCommitter,
    );

    const event = await committer.commit({
      kind: 'suspend',
      userId: userIdOf(1),
      expectedVersion: 0,
      at: T0,
    });

    expect(event).toMatchObject({ userId: userIdOf(1), type: 'suspended' });
  });

  test('ライフサイクルイベントの記録をD1の実装に解決し、未完了のイベントを数えられる', async () => {
    const store = createContainer().get<UserLifecycleStore>(
      IDENTITY_TYPES.UserLifecycleStore,
    );

    await expect(store.countOverduePurges(T0)).resolves.toBe(0);
  });

  test('ログイン試行の記録をDurable Objectの名前空間で数える', async () => {
    const throttle = createContainer().get<LoginThrottle>(
      AUTH_TYPES.LoginThrottle,
    );
    const hasher = createKeyedHasher(env.HASH_PEPPER);
    const keys = {
      email: await hashRateLimitKey(hasher, 'test', crypto.randomUUID()),
      ip: await hashRateLimitKey(hasher, 'test', crypto.randomUUID()),
    };
    const now = new Date();

    await expect(throttle.status('user', keys, now)).resolves.toEqual({
      locked: false,
    });
    await expect(throttle.recordFailure('user', keys, now)).resolves.toEqual({
      locked: false,
    });
    await throttle.reset('user', keys);
  });

  test('漏洩パスワードの照合は、APIサーバーのUser-Agentで照合サービスを呼ぶ', async () => {
    const requests = recordFetch();
    const checker = createContainer().get<PwnedPasswordChecker>(
      AUTH_TYPES.PwnedPasswordChecker,
    );

    await checker.check(['correct', 'horse', 'battery', 'staple'].join(' '));

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toMatch(
      /^https:\/\/api\.pwnedpasswords\.com\/range\//u,
    );
    expect(requests[0]?.headers.get('user-agent')).toBe('genai-example-2-api');
  });

  test('使い捨てメールアドレスの判定は、環境のキーとAPIサーバーのUser-Agentで判定サービスを呼ぶ', async () => {
    const apiKey = ['disify', 'test', 'key'].join('-');
    const requests = recordFetch();
    const checker = createContainer({
      DISIFY_API_KEY: apiKey,
    }).get<DisposableEmailChecker>(IDENTITY_TYPES.DisposableEmailChecker);

    await expect(checker.check('someone@mail.example')).resolves.toBe(
      'undetermined',
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('https://disify.com/api/email');
    expect(requests[0]?.headers.get('x-api-key')).toBe(apiKey);
    expect(requests[0]?.headers.get('user-agent')).toBe('genai-example-2-api');
  });

  test.each([
    { label: '空文字', apiKey: '' },
    { label: '未設定', apiKey: undefined },
  ])(
    '使い捨てメールアドレスの判定は、キーが$labelなら判定サービスを呼ばずに通常とする',
    async ({ apiKey }) => {
      const requests = recordFetch();
      const checker = createContainer({
        DISIFY_API_KEY: apiKey,
      }).get<DisposableEmailChecker>(IDENTITY_TYPES.DisposableEmailChecker);

      await expect(checker.check('someone@mail.example')).resolves.toBe(
        'regular',
      );

      expect(requests).toHaveLength(0);
    },
  );

  test.each([
    {
      appEnvironment: 'local',
      clientOrigin: 'http://localhost:48044',
      totpIssuer: 'Launch Stadium local',
    },
    {
      appEnvironment: 'staging',
      clientOrigin: 'https://genai-example-2-client-staging.lab.kurachiweb.com',
      totpIssuer: 'Launch Stadium staging',
    },
    {
      appEnvironment: 'prod',
      clientOrigin: 'https://genai-example-2-client.lab.kurachiweb.com',
      totpIssuer: 'Launch Stadium',
    },
  ] as const)(
    '利用者側のオリジンとTOTPの発行者名を環境($appEnvironment)から決める',
    ({ appEnvironment, clientOrigin, totpIssuer }) => {
      const settings = createContainer({
        APP_ENVIRONMENT: appEnvironment,
        CLIENT_SITE_ORIGIN: clientOrigin,
      }).get<IdentitySettings>(IDENTITY_TYPES.IdentitySettings);

      expect(settings).toEqual({ clientOrigin, totpIssuer });
    },
  );
});

describe('APIサーバーのセッションの検証', () => {
  async function issueUserSession(
    container: Container,
    issuedAt: Date = new Date(),
  ): Promise<string> {
    await insertUser(1);
    const issued = await container
      .get<SessionIssuer>(IDENTITY_TYPES.SessionIssuer)
      .issue(userIdOf(1), {
        clientIp: undefined,
        userAgent: undefined,
        now: issuedAt,
      });
    return issued.token;
  }

  test('最後の利用から15分以上経った利用者のセッションを検証すると、同じ識別子の延長の発行を応答のヘッダーへ書く', async () => {
    const container = createContainer();
    const token = await issueUserSession(
      container,
      new Date(Date.now() - 16 * 60 * 1000),
    );
    const access = createSessionAccess({ container, caller: 'client', token });

    await expect(access.principal()).resolves.toMatchObject({
      kind: 'authenticated',
      subjectId: userIdOf(1),
    });
    const headers = new Headers();
    applySessionInstructions(access, headers);

    expect(headers.get(SESSION_RESPONSE_HEADERS.issue)).toBe(token);
    expect(
      Number(headers.get(SESSION_RESPONSE_HEADERS.maxAge)),
    ).toBeGreaterThan(0);
    expect(headers.has(SESSION_RESPONSE_HEADERS.clear)).toBe(false);
  });

  test('セッションの検証に、主体の種類で振り分ける実装を束縛する', () => {
    expect(createContainer().get(SESSION_TYPES.SessionVerifier)).toBeInstanceOf(
      SubjectSessionVerifier,
    );
  });

  test('利用者側の呼び出し元のセッションを、保存済みの利用者のセッションと照合して有効にする', async () => {
    const container = createContainer();
    const token = await issueUserSession(container);

    const principal = await createSessionAccess({
      container,
      caller: 'client',
      token,
    }).principal();

    expect(principal).toMatchObject({
      kind: 'authenticated',
      subjectKind: 'user',
      subjectId: userIdOf(1),
    });
  });

  test('管理者側の呼び出し元は、利用者のセッションを渡しても管理者のセッションの検証で無効になる', async () => {
    const container = createContainer();
    const token = await issueUserSession(container);

    const principal = await createSessionAccess({
      container,
      caller: 'admin',
      token,
    }).principal();

    expect(principal).toEqual({ kind: 'anonymous' });
  });
});

describe('APIサーバーの環境の検証', () => {
  const validEnv = (): Record<string, unknown> => ({ ...env });

  const invalidKeysOf = (input: Record<string, unknown>): readonly string[] => {
    const result = apiEnvSchema.safeParse(input);
    return result.success
      ? []
      : result.error.issues.map(({ path }) => String(path[0]));
  };

  test('ローカル環境の設定を受け付ける', () => {
    expect(invalidKeysOf(validEnv())).toEqual([]);
  });

  test.each([
    'https://genai-example-2-client.lab.kurachiweb.com',
    'http://localhost:48044',
  ])('利用者側のオリジン%sを受け付ける', (origin) => {
    expect(
      invalidKeysOf({ ...validEnv(), CLIENT_SITE_ORIGIN: origin }),
    ).toEqual([]);
  });

  test.each([
    { label: '欠けている', value: undefined },
    { label: '空文字', value: '' },
    { label: '末尾にスラッシュがある', value: 'https://client.example/' },
    { label: 'パスを持つ', value: 'https://client.example/app' },
    { label: 'クエリを持つ', value: 'https://client.example?x=1' },
    { label: 'http・https以外', value: 'ftp://client.example' },
    { label: 'URLでない', value: 'client.example' },
  ])('利用者側のオリジンが$labelなら拒否する', ({ value }) => {
    expect(invalidKeysOf({ ...validEnv(), CLIENT_SITE_ORIGIN: value })).toEqual(
      ['CLIENT_SITE_ORIGIN'],
    );
  });

  test('ログイン試行の記録のDurable Objectのバインディングが無ければ拒否する', () => {
    expect(
      invalidKeysOf({ ...validEnv(), LOGIN_ATTEMPT_THROTTLE: undefined }),
    ).toEqual(['LOGIN_ATTEMPT_THROTTLE']);
  });

  test.each([
    { label: '未設定', value: undefined },
    { label: '空文字', value: '' },
    { label: '文字列', value: ['disify', 'test', 'key'].join('-') },
  ])(
    'ローカル環境では使い捨てメールアドレスの判定のキーが$labelでも受け付ける',
    ({ value }) => {
      expect(
        invalidKeysOf({
          ...validEnv(),
          APP_ENVIRONMENT: 'local',
          DISIFY_API_KEY: value,
        }),
      ).toEqual([]);
    },
  );

  test.each(['staging', 'prod'])(
    '%sでは使い捨てメールアドレスの判定のキーがあれば受け付ける',
    (environment) => {
      expect(
        invalidKeysOf({
          ...validEnv(),
          APP_ENVIRONMENT: environment,
          DISIFY_API_KEY: ['disify', 'test', 'key'].join('-'),
        }),
      ).toEqual([]);
    },
  );

  test.each([
    { environment: 'staging', value: undefined },
    { environment: 'staging', value: '' },
    { environment: 'prod', value: undefined },
    { environment: 'prod', value: '' },
  ])(
    '$environmentでは使い捨てメールアドレスの判定のキーが$valueなら拒否する',
    ({ environment, value }) => {
      expect(
        invalidKeysOf({
          ...validEnv(),
          APP_ENVIRONMENT: environment,
          DISIFY_API_KEY: value,
        }),
      ).toEqual(['DISIFY_API_KEY']);
    },
  );

  test('環境の種別が不正でも、使い捨てメールアドレスの判定のキーは種別の誤りに加えて報告しない', () => {
    expect(
      invalidKeysOf({
        ...validEnv(),
        APP_ENVIRONMENT: 'production',
        DISIFY_API_KEY: undefined,
      }),
    ).toEqual(['APP_ENVIRONMENT']);
  });

  test('使い捨てメールアドレスの判定のキーが文字列でなければ拒否する', () => {
    expect(invalidKeysOf({ ...validEnv(), DISIFY_API_KEY: 1 })).toEqual([
      'DISIFY_API_KEY',
    ]);
  });
});

describe('層をまたいで一致させる値', () => {
  test('保存するセッションのUser-Agentの上限が、要求から読む上限と同じである', () => {
    expect(SESSION_USER_AGENT_MAX_LENGTH).toBe(USER_AGENT_MAX_LENGTH);
  });

  test('運営者による退会の呼び出し元が、内部経路の呼び出し元の種類に含まれる', () => {
    expect(CALLER_KINDS).toContain(ADMINISTRATIVE_CALLER);
  });
});
