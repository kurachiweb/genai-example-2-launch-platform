import type { Container } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { BotVerifier } from '../../../lib/workers/bot-protection/turnstile-verifier.ts';
import type { CallerKind } from '../gateway/gateway-headers.ts';
import type { SessionAccess } from '../gateway/session-access.ts';
import { createLoaderRegistry, type LoaderRegistry } from './loaders.ts';

export interface GraphQLContextScope {
  readonly access: { readonly caller: CallerKind };
  readonly container: Container;
  readonly correlationId: string;
  readonly clientIp: string | undefined;
  readonly session: SessionAccess;
  readonly botToken: string | undefined;
}

export interface GraphQLContext {
  readonly caller: CallerKind;
  readonly correlationId: string;
  readonly clientIp: string | undefined;
  readonly session: SessionAccess;
  readonly loaders: LoaderRegistry;
  // 識別子のシンボルは取得する値の型を持たないため、コンテナのgetと同じく呼び出し側が型を指定する
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  resolve<T>(identifier: symbol): T;
  assertHuman(expectedAction?: string): Promise<void>;
}

// Yogaは文脈の項目を自身の文脈オブジェクトへ写すため、メソッドはthisに依存しないクロージャにする
export function createGraphQLContext(
  scope: GraphQLContextScope,
): GraphQLContext {
  const { container, clientIp, botToken } = scope;
  return {
    caller: scope.access.caller,
    correlationId: scope.correlationId,
    clientIp,
    session: scope.session,
    loaders: createLoaderRegistry({
      resolve: (identifier) => container.get(identifier),
    }),
    resolve: (identifier) => container.get(identifier),
    assertHuman: (expectedAction) =>
      container.get<BotVerifier>(PLATFORM_TYPES.BotVerifier).assertHuman({
        token: botToken,
        remoteIp: clientIp,
        ...(expectedAction !== undefined && { expectedAction }),
      }),
  };
}
