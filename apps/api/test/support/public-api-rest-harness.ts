import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Hono } from 'hono';
import type { Container } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { createWorkerApp } from '../../lib/workers/http/create-worker-app.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { apiEnvSchema } from '../../src/composition/env-schema.ts';
import { MODULES } from '../../src/composition/modules.ts';
import {
  PUBLIC_API_BASE_PATH,
  type PublicRestRoutes,
} from '../../src/presentation/rest/public-api-app.ts';
import { createRestModule } from '../../src/presentation/rest/rest-module.ts';
import {
  createRecordingFetch,
  recordingSentryOptions,
} from './observability-recording.ts';

const BASE_URL = 'https://api.launch.example';

export interface PublicApiRestRequest {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface PublicApiRestHarness {
  // pathは公開RESTの基準パスからの相対のパス
  readonly request: (
    path: string,
    init?: PublicApiRestRequest,
  ) => Promise<Response>;
}

// 公開RESTの経路を、apiの全ての束縛と環境の検証を載せたアプリで、基準パスの下に登録して呼ぶ。束縛の差し替え(時計の固定など)と、apiの束縛のモジュールにまだ無い束縛はoverridesで加える
export function createPublicApiRestHarness(
  routes: readonly PublicRestRoutes<Env>[],
  overrides: readonly AppModule<Hono<PlatformHonoEnv<Env>>>[] = [],
): PublicApiRestHarness {
  const rest = createRestModule<Env>(routes);
  const app: Hono<PlatformHonoEnv<Env>> = createWorkerApp<Env>({
    appName: 'api',
    envSchema: apiEnvSchema,
    modules: [...MODULES, ...overrides, rest.module],
    rateLimitExclusions: [],
    sentry: recordingSentryOptions(createRecordingFetch(), {
      tracesSampleRate: 0,
    }),
  });
  return {
    request: async (path, init = {}) => {
      const ctx = createExecutionContext();
      const response = await app.fetch(
        new Request(`${BASE_URL}${PUBLIC_API_BASE_PATH}${path}`, {
          method: init.method ?? 'GET',
          headers: init.headers ?? {},
          body: init.body,
        }),
        env,
        ctx,
      );
      await waitOnExecutionContext(ctx);
      return response;
    },
  };
}

// 経路の外で公開APIの部品を確かめるため、apiの全ての束縛(とoverrides)からfetchの処理単位のコンテナを作る
export function createPublicApiTestContainer(
  overrides: readonly AppModule<Hono<PlatformHonoEnv<Env>>>[] = [],
): Container {
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
    [...MODULES, ...overrides],
  );
}
