import type { Hono } from 'hono';
import {
  type Bind,
  ContainerModule,
  type ResolutionContext,
  type ServiceIdentifier,
} from 'inversify';

import type { Database } from '../../db/client.ts';
import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import type { DisposableEmailChecker } from '../../lib/core/identity/disposable-email.ts';
import type { UserLifecycleStore } from '../../lib/core/identity/ports.ts';
import type { IdGenerator } from '../../lib/core/ids/id-generator.ts';
import type { ScheduledJobHandler } from '../../lib/core/scheduling/cron-registry.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { createUserLifecycleStore } from '../../lib/workers/identity/d1-user-lifecycle-store.ts';
import { createDisifyClient } from '../../lib/workers/identity/disify-client.ts';
import { AUTH_TYPES } from '../application/auth/auth-types.ts';
import {
  CheckingPasswordPolicy,
  type PasswordPolicy,
} from '../application/auth/password-policy.ts';
import type {
  AuthIncidentReporter,
  LoginThrottle,
  PasswordHasher,
  PwnedPasswordChecker,
  SecretBox,
  SecretGenerator,
  TotpAuthenticator,
} from '../application/auth/ports.ts';
import {
  HashingRecoveryCodeIssuer,
  type RecoveryCodeIssuer,
} from '../application/auth/recovery-code-issuer.ts';
import {
  HashingSecretIssuer,
  type SecretIssuer,
} from '../application/auth/secret-issuer.ts';
import {
  type AccountGuard,
  StoreAccountGuard,
} from '../application/identity/account-guard.ts';
import {
  type AdministrativeWithdrawal,
  StoreAdministrativeWithdrawal,
} from '../application/identity/administrative-withdrawal.ts';
import {
  type DisposableEmailCheck,
  SavingDisposableEmailCheck,
} from '../application/identity/disposable-email-check.ts';
import {
  type EmailChange,
  StoreEmailChange,
} from '../application/identity/email-change.ts';
import {
  type EmailVerification,
  StoreEmailVerification,
} from '../application/identity/email-verification.ts';
import { IDENTITY_TYPES } from '../application/identity/identity-types.ts';
import { CredentialCleanupJob } from '../application/identity/jobs/credential-cleanup-job.ts';
import { DisposableRecheckSweepJob } from '../application/identity/jobs/disposable-recheck-sweep-job.ts';
import { LifecycleRedispatchJob } from '../application/identity/jobs/lifecycle-redispatch-job.ts';
import { PurgeOrchestratorJob } from '../application/identity/jobs/purge-orchestrator-job.ts';
import { type Login, StoreLogin } from '../application/identity/login.ts';
import {
  type PasswordChange,
  StorePasswordChange,
} from '../application/identity/password-change.ts';
import {
  type PasswordReset,
  StorePasswordReset,
} from '../application/identity/password-reset.ts';
import type {
  AuthTokenStore,
  DeviceDescriber,
  HandleAvailability,
  IdentityMailer,
  IdentitySettings,
  LoginChallengeStore,
  MailSendLimits,
  RecoveryCodeStore,
  TotpCredentialStore,
  UserAccountStore,
  UserLifecycleCommitter,
  UserSessionStore,
} from '../application/identity/ports.ts';
import {
  type ReAuthenticator,
  StoreReAuthenticator,
} from '../application/identity/re-authenticator.ts';
import {
  type Registration,
  StoreRegistration,
} from '../application/identity/registration.ts';
import {
  type SessionIssuer,
  StoreSessionIssuer,
} from '../application/identity/session-issuer.ts';
import {
  type SessionManagement,
  StoreSessionManagement,
} from '../application/identity/session-management.ts';
import {
  StoreTotpManagement,
  type TotpManagement,
} from '../application/identity/totp-management.ts';
import {
  StoreUserSuspension,
  type UserSuspension,
} from '../application/identity/user-suspension.ts';
import {
  StoreWithdrawal,
  type Withdrawal,
} from '../application/identity/withdrawal.ts';
import { CryptoSecretGenerator } from '../infrastructure/auth/crypto-secret-generator.ts';
import { createDurableLoginThrottle } from '../infrastructure/auth/durable-login-throttle.ts';
import { HibpPwnedPasswordChecker } from '../infrastructure/auth/hibp-pwned-password-checker.ts';
import { HkdfAesGcmSecretBox } from '../infrastructure/auth/hkdf-aes-gcm-secret-box.ts';
import { OtpauthTotpAuthenticator } from '../infrastructure/auth/otpauth-totp-authenticator.ts';
import { Pbkdf2PasswordHasher } from '../infrastructure/auth/pbkdf2-password-hasher.ts';
import { SentryAuthIncidentReporter } from '../infrastructure/auth/sentry-auth-incident-reporter.ts';
import { BowserDeviceDescriber } from '../infrastructure/identity/bowser-device-describer.ts';
import { CounterMailSendLimits } from '../infrastructure/identity/counter-mail-send-limits.ts';
import { D1AuthTokenStore } from '../infrastructure/identity/d1-auth-token-store.ts';
import { D1HandleAvailability } from '../infrastructure/identity/d1-handle-availability.ts';
import { D1LoginChallengeStore } from '../infrastructure/identity/d1-login-challenge-store.ts';
import { D1RecoveryCodeStore } from '../infrastructure/identity/d1-recovery-code-store.ts';
import { D1TotpCredentialStore } from '../infrastructure/identity/d1-totp-credential-store.ts';
import { D1UserAccountStore } from '../infrastructure/identity/d1-user-account-store.ts';
import { createD1UserLifecycleCommitter } from '../infrastructure/identity/d1-user-lifecycle-committer.ts';
import { D1UserSessionStore } from '../infrastructure/identity/d1-user-session-store.ts';
import { EmailIdentityMailer } from '../infrastructure/identity/email-identity-mailer.ts';
import type { AppEnvironment } from '../presentation/gateway/gateway-headers.ts';
import type { ApiEnv } from './env-schema.ts';
import { HANDLE_AVAILABILITY } from './identity-registrations.ts';
import { USER_LIFECYCLE_SYNC_HANDLERS } from './user-lifecycle-sync-handlers.ts';

const APP_NAME = 'api';

// 漏洩パスワードの照合と使い捨てメールアドレスの判定の運営者が、呼び出し元を識別できるようにする
const EXTERNAL_USER_AGENT = 'genai-example-2-api';

// 認証アプリに表示される発行者名。環境ごとに分け、同じ利用者の別の環境の設定と見分けられるようにする
const TOTP_ISSUERS: Readonly<Record<AppEnvironment, string>> = Object.freeze({
  local: 'Launch Stadium local',
  staging: 'Launch Stadium staging',
  prod: 'Launch Stadium',
});

const envOf = (context: ResolutionContext): ApiEnv =>
  context.get<ApiEnv>(PLATFORM_TYPES.Env);

function bindAuth(bind: Bind): void {
  bind<PasswordHasher>(AUTH_TYPES.PasswordHasher).to(Pbkdf2PasswordHasher);
  bind<PwnedPasswordChecker>(AUTH_TYPES.PwnedPasswordChecker)
    .toDynamicValue(
      () =>
        new HibpPwnedPasswordChecker({
          // workerdのfetchは別のオブジェクトのメソッドとして呼ぶと不正な呼び出しになるため、呼び出し時に大域のfetchを引く
          fetch: (input, init) => fetch(input, init),
          userAgent: EXTERNAL_USER_AGENT,
        }),
    )
    .inSingletonScope();
  bind<PasswordPolicy>(AUTH_TYPES.PasswordPolicy).to(CheckingPasswordPolicy);
  bind<SecretGenerator>(AUTH_TYPES.SecretGenerator).to(CryptoSecretGenerator);
  bind<SecretIssuer>(AUTH_TYPES.SecretIssuer).to(HashingSecretIssuer);
  bind<SecretBox>(AUTH_TYPES.SecretBox).to(HkdfAesGcmSecretBox);
  bind<TotpAuthenticator>(AUTH_TYPES.TotpAuthenticator).to(
    OtpauthTotpAuthenticator,
  );
  bind<RecoveryCodeIssuer>(AUTH_TYPES.RecoveryCodeIssuer).to(
    HashingRecoveryCodeIssuer,
  );
  bind<LoginThrottle>(AUTH_TYPES.LoginThrottle)
    .toDynamicValue((context) =>
      createDurableLoginThrottle(
        envOf(context).LOGIN_ATTEMPT_THROTTLE,
        context.get<AuthIncidentReporter>(AUTH_TYPES.AuthIncidentReporter),
      ),
    )
    .inSingletonScope();
  bind<AuthIncidentReporter>(AUTH_TYPES.AuthIncidentReporter).to(
    SentryAuthIncidentReporter,
  );
}

function bindStores(
  bind: Bind,
  handleAvailability: ServiceIdentifier<HandleAvailability>,
): void {
  bind<UserAccountStore>(IDENTITY_TYPES.UserAccountStore).to(
    D1UserAccountStore,
  );
  bind<UserSessionStore>(IDENTITY_TYPES.UserSessionStore).to(
    D1UserSessionStore,
  );
  bind<AuthTokenStore>(IDENTITY_TYPES.AuthTokenStore).to(D1AuthTokenStore);
  bind<LoginChallengeStore>(IDENTITY_TYPES.LoginChallengeStore).to(
    D1LoginChallengeStore,
  );
  bind<TotpCredentialStore>(IDENTITY_TYPES.TotpCredentialStore).to(
    D1TotpCredentialStore,
  );
  bind<RecoveryCodeStore>(IDENTITY_TYPES.RecoveryCodeStore).to(
    D1RecoveryCodeStore,
  );
  bind<UserLifecycleCommitter>(IDENTITY_TYPES.UserLifecycleCommitter)
    .toDynamicValue((context) =>
      createD1UserLifecycleCommitter(
        context.get<Database>(PLATFORM_TYPES.Database),
        context.get<IdGenerator>(PLATFORM_TYPES.IdGenerator),
        USER_LIFECYCLE_SYNC_HANDLERS,
        (identifier) => context.get(identifier),
      ),
    )
    .inSingletonScope();
  bind<UserLifecycleStore>(IDENTITY_TYPES.UserLifecycleStore)
    .toDynamicValue((context) =>
      createUserLifecycleStore(
        context.get<Database>(PLATFORM_TYPES.Database),
        context.get<IdGenerator>(PLATFORM_TYPES.IdGenerator),
      ),
    )
    .inSingletonScope();
  bind(D1HandleAvailability).toSelf();
  bind<HandleAvailability>(IDENTITY_TYPES.HandleAvailability).toService(
    handleAvailability,
  );
}

function bindServices(bind: Bind): void {
  bind<DisposableEmailChecker>(IDENTITY_TYPES.DisposableEmailChecker)
    .toDynamicValue((context) =>
      createDisifyClient({
        appName: APP_NAME,
        fetch: (input, init) => fetch(input, init),
        apiKey: envOf(context).DISIFY_API_KEY,
        userAgent: EXTERNAL_USER_AGENT,
      }),
    )
    .inSingletonScope();
  bind<DeviceDescriber>(IDENTITY_TYPES.DeviceDescriber).to(
    BowserDeviceDescriber,
  );
  bind<IdentityMailer>(IDENTITY_TYPES.IdentityMailer).to(EmailIdentityMailer);
  bind<IdentitySettings>(IDENTITY_TYPES.IdentitySettings)
    .toDynamicValue((context) => {
      const env = envOf(context);
      return Object.freeze({
        clientOrigin: env.CLIENT_SITE_ORIGIN,
        totpIssuer: TOTP_ISSUERS[env.APP_ENVIRONMENT],
      });
    })
    .inSingletonScope();
  bind<MailSendLimits>(IDENTITY_TYPES.MailSendLimits).to(CounterMailSendLimits);
}

function bindUseCases(bind: Bind): void {
  bind<SessionIssuer>(IDENTITY_TYPES.SessionIssuer).to(StoreSessionIssuer);
  // 利用者の読み取りを要求の中で使い回すため、処理単位で1つにする
  bind<AccountGuard>(IDENTITY_TYPES.AccountGuard)
    .to(StoreAccountGuard)
    .inSingletonScope();
  bind<Registration>(IDENTITY_TYPES.Registration).to(StoreRegistration);
  bind<EmailVerification>(IDENTITY_TYPES.EmailVerification)
    .to(StoreEmailVerification)
    .inSingletonScope();
  bind<DisposableEmailCheck>(IDENTITY_TYPES.DisposableEmailCheck).to(
    SavingDisposableEmailCheck,
  );
  bind<Login>(IDENTITY_TYPES.Login).to(StoreLogin);
  bind<ReAuthenticator>(IDENTITY_TYPES.ReAuthenticator).to(
    StoreReAuthenticator,
  );
  bind<SessionManagement>(IDENTITY_TYPES.SessionManagement).to(
    StoreSessionManagement,
  );
  bind<PasswordReset>(IDENTITY_TYPES.PasswordReset).to(StorePasswordReset);
  bind<EmailChange>(IDENTITY_TYPES.EmailChange).to(StoreEmailChange);
  bind<PasswordChange>(IDENTITY_TYPES.PasswordChange).to(StorePasswordChange);
  bind<TotpManagement>(IDENTITY_TYPES.TotpManagement).to(StoreTotpManagement);
  bind<Withdrawal>(IDENTITY_TYPES.Withdrawal).to(StoreWithdrawal);
  bind<AdministrativeWithdrawal>(IDENTITY_TYPES.AdministrativeWithdrawal).to(
    StoreAdministrativeWithdrawal,
  );
  bind<UserSuspension>(IDENTITY_TYPES.UserSuspension).to(StoreUserSuspension);
}

function bindJobs(bind: Bind): void {
  bind<ScheduledJobHandler>(IDENTITY_TYPES.PurgeOrchestratorJob).to(
    PurgeOrchestratorJob,
  );
  bind<ScheduledJobHandler>(IDENTITY_TYPES.CredentialCleanupJob).to(
    CredentialCleanupJob,
  );
  bind<ScheduledJobHandler>(IDENTITY_TYPES.DisposableRecheckSweepJob).to(
    DisposableRecheckSweepJob,
  );
  bind<ScheduledJobHandler>(IDENTITY_TYPES.LifecycleRedispatchJob).to(
    LifecycleRedispatchJob,
  );
}

export interface IdentityRegistrations {
  readonly handleAvailability: ServiceIdentifier<HandleAvailability>;
}

export function createIdentityModule({
  handleAvailability,
}: IdentityRegistrations): AppModule<Hono<PlatformHonoEnv<Env>>> {
  return {
    name: 'identity',
    bindings: new ContainerModule(({ bind }) => {
      bindAuth(bind);
      bindStores(bind, handleAvailability);
      bindServices(bind);
      bindUseCases(bind);
      bindJobs(bind);
    }),
  };
}

export const IDENTITY_MODULE: AppModule<Hono<PlatformHonoEnv<Env>>> =
  createIdentityModule({ handleAvailability: HANDLE_AVAILABILITY });
