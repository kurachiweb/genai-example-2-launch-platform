import { Container } from 'inversify';

import type { AdminRole } from '../../common-lib/admin/admin-roles.ts';
import type { Principal } from '../../lib/core/session/session-view.ts';
import {
  type AdminAuthorizer,
  StoreAdminAuthorizer,
} from '../../src/application/admin/admin-authorizer.ts';
import { ADMIN_TYPES } from '../../src/application/admin/admin-types.ts';
import type {
  AdminAccountStore,
  AdminRecord,
} from '../../src/application/admin/ports.ts';
import type { CallerKind } from '../../src/presentation/gateway/gateway-headers.ts';
import type { SessionAccess } from '../../src/presentation/gateway/session-access.ts';
import type { GraphQLContext } from '../../src/presentation/graphql/graphql-context.ts';

export const AUTHORIZED_ADMIN_ID = '01JC0ADMN00000000000000001';
export const AUTHORIZED_SESSION_ID = '01JC0SESN00000000000000001';
export const AUTHORIZED_NICKNAME = '管理者1';

const ACTIVATED_AT = new Date('2026-11-01T00:00:00.000Z');

export const ADMIN_PRINCIPAL: Principal = Object.freeze({
  kind: 'authenticated',
  subjectKind: 'admin',
  subjectId: AUTHORIZED_ADMIN_ID,
  sessionId: AUTHORIZED_SESSION_ID,
});

export function storedAdminOf(
  role: AdminRole,
  overrides: Partial<AdminRecord> = {},
): AdminRecord {
  return {
    id: AUTHORIZED_ADMIN_ID,
    role,
    status: 'active',
    invitationExpiresAt: null,
    email: 'admin1@mail.example',
    passwordHash: 'pbkdf2-sha256$test',
    nickname: AUTHORIZED_NICKNAME,
    title: null,
    avatarFileId: null,
    createdAt: ACTIVATED_AT,
    activatedAt: ACTIVATED_AT,
    ...overrides,
  };
}

export interface AuthorizationContextInput {
  readonly caller?: CallerKind;
  readonly principal?: Principal;
  readonly admin: AdminRecord | undefined;
}

export interface AuthorizationContext {
  readonly context: GraphQLContext;
  readonly container: Container;
  // 認可が保存済みの管理者を読んだ回数で、呼び出し元やセッションの拒否が管理者を読む前に起きたことを確かめる
  readonly reads: readonly string[];
}

// 本物の認可(StoreAdminAuthorizer)を処理単位のコンテナから解決するGraphQLの文脈。保存済みの管理者だけを差し替える
export function authorizationContextOf(
  input: AuthorizationContextInput,
): AuthorizationContext {
  const reads: string[] = [];
  const store = {
    findById: (adminId: string) => {
      reads.push(adminId);
      return Promise.resolve(
        input.admin?.id === adminId ? input.admin : undefined,
      );
    },
  } as Pick<AdminAccountStore, 'findById'> as AdminAccountStore;
  const container = new Container();
  container
    .bind<AdminAuthorizer>(ADMIN_TYPES.AdminAuthorizer)
    .toConstantValue(new StoreAdminAuthorizer(store));
  const principal = input.principal ?? ADMIN_PRINCIPAL;
  const session = {
    principal: () => Promise.resolve(principal),
  } as Pick<SessionAccess, 'principal'> as SessionAccess;
  const context: Pick<GraphQLContext, 'caller' | 'session' | 'resolve'> = {
    caller: input.caller ?? 'admin',
    session,
    resolve: (identifier) => container.get(identifier),
  };
  return { context: context as GraphQLContext, container, reads };
}
