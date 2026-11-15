import type { Hono } from 'hono';
import { type Bind, ContainerModule, type ResolutionContext } from 'inversify';

import {
  type AuditActionCatalog,
  createAuditActionCatalog,
} from '../../common-lib/admin/audit-action.ts';
import { AUDIT_ACTIONS } from '../../common-lib/admin/audit-actions/index.ts';
import type { AuditLogRecorder } from '../../lib/core/admin/audit-log.ts';
import { ADMIN_PLATFORM_TYPES } from '../../lib/core/admin/identifiers.ts';
import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import type { ScheduledJobHandler } from '../../lib/core/scheduling/cron-registry.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import {
  type AdminAccountManagement,
  StoreAdminAccountManagement,
} from '../application/admin/admin-account-management.ts';
import {
  type AdminAuthorizer,
  StoreAdminAuthorizer,
} from '../application/admin/admin-authorizer.ts';
import {
  type AdminEmailChange,
  StoreAdminEmailChange,
} from '../application/admin/admin-email-change.ts';
import {
  type AdminInvitation,
  StoreAdminInvitation,
} from '../application/admin/admin-invitation.ts';
import {
  type AdminLogin,
  StoreAdminLogin,
} from '../application/admin/admin-login.ts';
import {
  type AdminPasswordChange,
  StoreAdminPasswordChange,
} from '../application/admin/admin-password-change.ts';
import {
  type AdminPasswordReset,
  StoreAdminPasswordReset,
} from '../application/admin/admin-password-reset.ts';
import {
  type AdminProfile,
  StoreAdminProfile,
} from '../application/admin/admin-profile.ts';
import {
  type AdminReAuthenticator,
  StoreAdminReAuthenticator,
} from '../application/admin/admin-re-authenticator.ts';
import {
  type AdminSessionIssuer,
  StoreAdminSessionIssuer,
} from '../application/admin/admin-session-issuer.ts';
import {
  type AdminTotpManagement,
  StoreAdminTotpManagement,
} from '../application/admin/admin-totp-management.ts';
import { AdminSessionVerifier } from '../application/admin/admin-session-verifier.ts';
import { ADMIN_TYPES } from '../application/admin/admin-types.ts';
import {
  type AuditLogReader,
  StoreAuditLogReader,
} from '../application/admin/audit-log-reader.ts';
import { StoreAuditLogRecorder } from '../application/admin/audit-log-recorder.ts';
import { AdminCredentialCleanupJob } from '../application/admin/jobs/admin-credential-cleanup-job.ts';
import { AuditLogRetentionJob } from '../application/admin/jobs/audit-log-retention-job.ts';
import type {
  AdminAccountStore,
  AdminAuthTokenStore,
  AdminLoginChallengeStore,
  AdminMailer,
  AdminMailSendLimits,
  AdminRecoveryCodeStore,
  AdminSessionStore,
  AdminSettings,
  AdminTotpCredentialStore,
  AuditLogStore,
} from '../application/admin/ports.ts';
import type { SubjectSessionVerifierPort } from '../application/auth/subject-session-verifier.ts';
import { CounterAdminMailSendLimits } from '../infrastructure/admin/counter-admin-mail-send-limits.ts';
import { D1AdminAccountStore } from '../infrastructure/admin/d1-admin-account-store.ts';
import { D1AdminAuthTokenStore } from '../infrastructure/admin/d1-admin-auth-token-store.ts';
import { D1AdminLoginChallengeStore } from '../infrastructure/admin/d1-admin-login-challenge-store.ts';
import { D1AdminRecoveryCodeStore } from '../infrastructure/admin/d1-admin-recovery-code-store.ts';
import { D1AdminSessionStore } from '../infrastructure/admin/d1-admin-session-store.ts';
import { D1AdminTotpCredentialStore } from '../infrastructure/admin/d1-admin-totp-credential-store.ts';
import { D1AuditLogStore } from '../infrastructure/admin/d1-audit-log-store.ts';
import { EmailAdminMailer } from '../infrastructure/admin/email-admin-mailer.ts';
import type { AppEnvironment } from '../presentation/gateway/gateway-headers.ts';
import type { ApiEnv } from './env-schema.ts';

// 認証アプリに表示される発行者名。環境ごとと利用者側とで分け、同じ認証アプリに並ぶ別の設定と見分けられるようにする
const ADMIN_TOTP_ISSUERS: Readonly<Record<AppEnvironment, string>> =
  Object.freeze({
    local: 'Launch Stadium Admin local',
    staging: 'Launch Stadium Admin staging',
    prod: 'Launch Stadium Admin',
  });

// 登録の誤りをデプロイ前に検出するため、モジュールの読み込み時に操作種別のカタログを作る
const AUDIT_ACTION_CATALOG: AuditActionCatalog =
  createAuditActionCatalog(AUDIT_ACTIONS);

const envOf = (context: ResolutionContext): ApiEnv =>
  context.get<ApiEnv>(PLATFORM_TYPES.Env);

function bindStores(bind: Bind): void {
  bind<AdminAccountStore>(ADMIN_TYPES.AdminAccountStore).to(
    D1AdminAccountStore,
  );
  bind<AdminSessionStore>(ADMIN_TYPES.AdminSessionStore).to(
    D1AdminSessionStore,
  );
  bind<AdminLoginChallengeStore>(ADMIN_TYPES.AdminLoginChallengeStore).to(
    D1AdminLoginChallengeStore,
  );
  bind<AdminTotpCredentialStore>(ADMIN_TYPES.AdminTotpCredentialStore).to(
    D1AdminTotpCredentialStore,
  );
  bind<AdminRecoveryCodeStore>(ADMIN_TYPES.AdminRecoveryCodeStore).to(
    D1AdminRecoveryCodeStore,
  );
  bind<AdminAuthTokenStore>(ADMIN_TYPES.AdminAuthTokenStore).to(
    D1AdminAuthTokenStore,
  );
  bind<AuditLogStore>(ADMIN_TYPES.AuditLogStore).to(D1AuditLogStore);
  bind<AdminMailSendLimits>(ADMIN_TYPES.AdminMailSendLimits).to(
    CounterAdminMailSendLimits,
  );
}

function bindServices(bind: Bind): void {
  bind<AuditActionCatalog>(ADMIN_TYPES.AuditActionCatalog).toConstantValue(
    AUDIT_ACTION_CATALOG,
  );
  bind<AdminSettings>(ADMIN_TYPES.AdminSettings)
    .toDynamicValue((context) => {
      const env = envOf(context);
      return Object.freeze({
        adminOrigin: env.ADMIN_SITE_ORIGIN,
        totpIssuer: ADMIN_TOTP_ISSUERS[env.APP_ENVIRONMENT],
      });
    })
    .inSingletonScope();
  bind<AdminMailer>(ADMIN_TYPES.AdminMailer).to(EmailAdminMailer);
}

function bindAuditLog(bind: Bind): void {
  bind<AuditLogRecorder>(ADMIN_PLATFORM_TYPES.AuditLogRecorder).to(
    StoreAuditLogRecorder,
  );
  bind<AuditLogReader>(ADMIN_TYPES.AuditLogReader).to(StoreAuditLogReader);
}

function bindUseCases(bind: Bind): void {
  bind<AdminSessionIssuer>(ADMIN_TYPES.AdminSessionIssuer).to(
    StoreAdminSessionIssuer,
  );
  bind<SubjectSessionVerifierPort>(ADMIN_TYPES.AdminSessionVerifier).to(
    AdminSessionVerifier,
  );
  // 保存済みのロールの読み取りを要求の中で使い回すため、処理単位で1つにする
  bind<AdminAuthorizer>(ADMIN_TYPES.AdminAuthorizer)
    .to(StoreAdminAuthorizer)
    .inSingletonScope();
  bind<AdminLogin>(ADMIN_TYPES.AdminLogin).to(StoreAdminLogin);
  bind<AdminReAuthenticator>(ADMIN_TYPES.AdminReAuthenticator).to(
    StoreAdminReAuthenticator,
  );
  bind<AdminInvitation>(ADMIN_TYPES.AdminInvitation).to(StoreAdminInvitation);
  bind<AdminPasswordReset>(ADMIN_TYPES.AdminPasswordReset).to(
    StoreAdminPasswordReset,
  );
  bind<AdminEmailChange>(ADMIN_TYPES.AdminEmailChange).to(
    StoreAdminEmailChange,
  );
  bind<AdminPasswordChange>(ADMIN_TYPES.AdminPasswordChange).to(
    StoreAdminPasswordChange,
  );
  bind<AdminTotpManagement>(ADMIN_TYPES.AdminTotpManagement).to(
    StoreAdminTotpManagement,
  );
  bind<AdminAccountManagement>(ADMIN_TYPES.AdminAccountManagement).to(
    StoreAdminAccountManagement,
  );
  bind<AdminProfile>(ADMIN_TYPES.AdminProfile).to(StoreAdminProfile);
}

function bindJobs(bind: Bind): void {
  bind<ScheduledJobHandler>(ADMIN_TYPES.AdminCredentialCleanupJob).to(
    AdminCredentialCleanupJob,
  );
  bind<ScheduledJobHandler>(ADMIN_TYPES.AuditLogRetentionJob).to(
    AuditLogRetentionJob,
  );
}

// 認証部品の束縛(AUTH_TYPES)は利用者のモジュールのものをそのまま使う
export const ADMIN_MODULE: AppModule<Hono<PlatformHonoEnv<Env>>> = {
  name: 'admin',
  bindings: new ContainerModule(({ bind }) => {
    bindStores(bind);
    bindServices(bind);
    bindAuditLog(bind);
    bindUseCases(bind);
    bindJobs(bind);
  }),
};
