import type { Hono } from 'hono';
import { type Bind, ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
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
import type {
  AdminAccountStore,
  AdminLoginChallengeStore,
  AdminMailSendLimits,
  AdminRecoveryCodeStore,
  AdminSessionStore,
  AdminTotpCredentialStore,
} from '../application/admin/ports.ts';
import type { SubjectSessionVerifierPort } from '../application/auth/subject-session-verifier.ts';
import { CounterAdminMailSendLimits } from '../infrastructure/admin/counter-admin-mail-send-limits.ts';
import { D1AdminAccountStore } from '../infrastructure/admin/d1-admin-account-store.ts';
import { D1AdminLoginChallengeStore } from '../infrastructure/admin/d1-admin-login-challenge-store.ts';
import { D1AdminRecoveryCodeStore } from '../infrastructure/admin/d1-admin-recovery-code-store.ts';
import { D1AdminSessionStore } from '../infrastructure/admin/d1-admin-session-store.ts';
import { D1AdminTotpCredentialStore } from '../infrastructure/admin/d1-admin-totp-credential-store.ts';

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
  bind<AdminMailSendLimits>(ADMIN_TYPES.AdminMailSendLimits).to(
    CounterAdminMailSendLimits,
  );
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
}

// 認証部品の束縛(AUTH_TYPES)は利用者のモジュールのものをそのまま使う
export const ADMIN_MODULE: AppModule<Hono<PlatformHonoEnv<Env>>> = {
  name: 'admin',
  bindings: new ContainerModule(({ bind }) => {
    bindStores(bind);
    bindUseCases(bind);
  }),
};
