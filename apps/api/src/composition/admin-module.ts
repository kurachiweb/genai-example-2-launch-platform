import type { Hono } from 'hono';
import { type Bind, ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import {
  type AdminSessionIssuer,
  StoreAdminSessionIssuer,
} from '../application/admin/admin-session-issuer.ts';
import { AdminSessionVerifier } from '../application/admin/admin-session-verifier.ts';
import { ADMIN_TYPES } from '../application/admin/admin-types.ts';
import type { AdminSessionStore } from '../application/admin/ports.ts';
import type { SubjectSessionVerifierPort } from '../application/auth/subject-session-verifier.ts';
import { D1AdminSessionStore } from '../infrastructure/admin/d1-admin-session-store.ts';

function bindStores(bind: Bind): void {
  bind<AdminSessionStore>(ADMIN_TYPES.AdminSessionStore).to(
    D1AdminSessionStore,
  );
}

function bindUseCases(bind: Bind): void {
  bind<AdminSessionIssuer>(ADMIN_TYPES.AdminSessionIssuer).to(
    StoreAdminSessionIssuer,
  );
  bind<SubjectSessionVerifierPort>(ADMIN_TYPES.AdminSessionVerifier).to(
    AdminSessionVerifier,
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
