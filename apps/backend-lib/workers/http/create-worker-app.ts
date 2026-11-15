import { Hono, type MiddlewareHandler } from 'hono';
import type { z } from 'zod';

import type { AppModule } from '../../core/di/app-module.ts';
import { createInvocationContainer } from '../di/invocation-container.ts';
import type { PlatformEnv } from '../env/platform-env.ts';
import {
  createSentryMiddleware,
  type SentryOptionsFactory,
} from '../observability/sentry.ts';
import {
  type ClientIpResolver,
  resolveConnectingIp,
} from '../rate-limit/client-ip.ts';
import type { RateLimitExclusion } from '../rate-limit/exclusions.ts';
import { ipRateLimit } from '../rate-limit/ip-rate-limit.ts';
import { envGuard } from './env-guard.ts';
import { createErrorHandler, handleNotFound } from './error-handler.ts';
import { registerHealthRoute } from './health-route.ts';
import type { PlatformHonoEnv } from './hono-env.ts';
import { invocationContext } from './invocation-context.ts';

export interface WorkerAppOptions<E extends PlatformEnv> {
  readonly appName: 'api' | 'event';
  // 検証の結果ではなく元の環境を使い続けるため、スキーマの出力の型は問わない
  readonly envSchema: z.ZodType;
  readonly modules: readonly AppModule<Hono<PlatformHonoEnv<E>>>[];
  readonly rateLimitExclusions: readonly RateLimitExclusion<E>[];
  readonly resolveClientIp?: ClientIpResolver;
  // 環境の検証より前に呼ばれるため、受け取る環境にはキーが欠けていることがある
  readonly sentry: SentryOptionsFactory<E>;
}

function requestContainer<E extends PlatformEnv>(
  modules: WorkerAppOptions<E>['modules'],
): MiddlewareHandler<PlatformHonoEnv<E>> {
  return async (c, next) => {
    c.set(
      'container',
      createInvocationContainer(
        {
          env: c.env,
          // 実体はworkerdのExecutionContextだが、Honoは実行環境に依存しない狭い型で宣言している
          executionCtx: c.executionCtx as ExecutionContext,
          info: {
            kind: 'fetch',
            correlationId: c.get('correlationId'),
            clientIp: c.get('clientIp'),
          },
        },
        modules,
      ),
    );
    await next();
  };
}

// ミドルウェアの順序はここだけで定める。ヘルスチェックは環境が欠けていても応答するよう、環境の検証より前に置く
export function createWorkerApp<E extends PlatformEnv>(
  options: WorkerAppOptions<E>,
): Hono<PlatformHonoEnv<E>> {
  const app = new Hono<PlatformHonoEnv<E>>();
  app.use(createSentryMiddleware(app, options.sentry));
  app.use(
    invocationContext({
      appName: options.appName,
      resolveClientIp: options.resolveClientIp ?? resolveConnectingIp,
    }),
  );
  app.use(ipRateLimit<E>(options.rateLimitExclusions));
  registerHealthRoute(app);
  app.use(envGuard({ appName: options.appName, envSchema: options.envSchema }));
  app.use(requestContainer(options.modules));
  for (const { routes } of options.modules) {
    routes?.(app);
  }
  app.notFound(handleNotFound);
  app.onError(createErrorHandler(options.appName));
  return app;
}
