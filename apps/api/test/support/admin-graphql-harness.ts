import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';

import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import type { AdminSessionIssuer } from '../../src/application/admin/admin-session-issuer.ts';
import { ADMIN_TYPES } from '../../src/application/admin/admin-types.ts';
import type { IssuedAdminSession } from '../../src/application/admin/ports.ts';
import { MODULES } from '../../src/composition/modules.ts';
import {
  createGraphQLGateway,
  type GraphQLGateway,
  type GraphQLGatewayOptions,
} from './graphql-gateway.ts';

export type AdminGatewayOptions = GraphQLGatewayOptions;

// 管理者の操作は管理者側の呼び出し元から受け付けるため、呼び出し元の既定を管理者側にする
export function createAdminGateway(
  options: AdminGatewayOptions,
): GraphQLGateway {
  const gateway = createGraphQLGateway(options);
  return {
    call: (document, variables, callOptions = {}) =>
      gateway.call(document, variables, { caller: 'admin', ...callOptions }),
  };
}

export function createAdminTestContainer(): Container {
  return createInvocationContainer(
    {
      env,
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

// 本物の発行の部品で保存済みの管理者のセッションを作る。発行日時を過去にすると、期限切れや延長の境界を再現できる
export function issueAdminSession(
  adminId: string,
  options: { readonly now?: Date; readonly userAgent?: string } = {},
): Promise<IssuedAdminSession> {
  return createAdminTestContainer()
    .get<AdminSessionIssuer>(ADMIN_TYPES.AdminSessionIssuer)
    .issue(adminId, {
      clientIp: undefined,
      userAgent: options.userAgent,
      now: options.now ?? new Date(),
    });
}
