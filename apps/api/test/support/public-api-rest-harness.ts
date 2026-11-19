import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Hono } from 'hono';

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

// 公開RESTの経路を、apiの全ての束縛と環境の検証を載せたアプリで、基準パスの下に登録して呼ぶ
export function createPublicApiRestHarness(
  routes: readonly PublicRestRoutes<Env>[],
): PublicApiRestHarness {
  const rest = createRestModule<Env>(routes);
  const app: Hono<PlatformHonoEnv<Env>> = createWorkerApp<Env>({
    appName: 'api',
    envSchema: apiEnvSchema,
    modules: [...MODULES, rest.module],
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
