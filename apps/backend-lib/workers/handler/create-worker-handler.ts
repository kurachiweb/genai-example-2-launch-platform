import { withContext } from '@logtape/logtape';
import { setTag } from '@sentry/cloudflare';
import type { Hono } from 'hono';
import type { z } from 'zod';

import type { InvocationScopeInfo } from '../../core/di/identifiers.ts';
import {
  EnvValidationError,
  logEnvValidationFailure,
  validateEnv,
} from '../../core/env/env-schema.ts';
import { getAppLogger } from '../../core/logging/app-logger.ts';
import type { PlatformEnv } from '../env/platform-env.ts';
import type { PlatformHonoEnv } from '../http/hono-env.ts';
import {
  ensureLoggingConfigured,
  type LoggingOptions,
} from '../logging/configure-logging.ts';
import type { QueueDispatcher } from '../messaging/queue-consumer.ts';
import {
  type SentryOptionsFactory,
  withSentryForScheduledAndQueue,
} from '../observability/sentry.ts';
import type { ScheduledDispatcher } from '../scheduling/scheduled-dispatcher.ts';

export interface WorkerHandlerOptions<E extends PlatformEnv> {
  readonly appName: LoggingOptions['appName'];
  readonly app: Hono<PlatformHonoEnv<E>>;
  // 検証の結果ではなく元の環境を使い続けるため、スキーマの出力の型は問わない
  readonly envSchema: z.ZodType;
  readonly scheduled?: ScheduledDispatcher<E>;
  readonly queue?: QueueDispatcher<E>;
  // 定期実行と非同期メッセージの計装に使う。Honoの経路はアプリの組み立て時に計装済み
  readonly sentry: SentryOptionsFactory<E>;
  readonly console?: Console;
}

type BackgroundKind = Exclude<InvocationScopeInfo['kind'], 'fetch'>;

export function createWorkerHandler<E extends PlatformEnv>(
  options: WorkerHandlerOptions<E>,
): ExportedHandler<E> {
  const { appName, app, envSchema, scheduled, queue } = options;
  const envLoggers = {
    scheduled: getAppLogger([appName, 'scheduled', 'env']),
    queue: getAppLogger([appName, 'queue', 'env']),
  } satisfies Record<BackgroundKind, unknown>;

  // 外部で設定が消された場合にも戻せるよう、組み立て時ではなく呼び出しのたびに確かめる
  function ensureLogging(env: E): void {
    ensureLoggingConfigured({
      appName,
      level: env.LOG_LEVEL,
      ...(options.console === undefined ? {} : { console: options.console }),
    });
  }

  function guardEnv(kind: BackgroundKind, env: E): void {
    try {
      validateEnv(envSchema, env);
    } catch (error) {
      if (error instanceof EnvValidationError) {
        logEnvValidationFailure(envLoggers[kind], error);
      }
      throw error;
    }
  }

  // 定期実行と非同期メッセージにはHTTPの文脈が無いため、ここで相関IDを採番してログとエラートラッキングの文脈に入れる
  function runInContext(
    kind: BackgroundKind,
    env: E,
    run: () => Promise<void>,
  ): Promise<void> {
    ensureLogging(env);
    const correlationId = crypto.randomUUID();
    setTag('correlation_id', correlationId);
    return withContext({ correlationId }, async () => {
      guardEnv(kind, env);
      await run();
    });
  }

  const handler: ExportedHandler<E> = {
    fetch(request, env, ctx) {
      ensureLogging(env);
      return app.fetch(request, env, ctx);
    },
    ...(scheduled && {
      scheduled: (controller, env, ctx) =>
        runInContext('scheduled', env, () =>
          scheduled.dispatch(controller, env, ctx),
        ),
    }),
    ...(queue && {
      queue: (batch, env, ctx) =>
        runInContext('queue', env, () => queue.dispatch(batch, env, ctx)),
    }),
  };
  return withSentryForScheduledAndQueue(options.sentry, handler);
}
