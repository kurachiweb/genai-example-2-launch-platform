import type { MiddlewareHandler } from 'hono';
import type { z } from 'zod';

import { EnvValidationError, validateEnv } from '../../core/env/env-schema.ts';
import { INTERNAL_ERROR_RESPONSE } from '../../core/errors/error-envelope.ts';
import { getAppLogger } from '../../core/logging/app-logger.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';

export interface EnvGuardOptions {
  readonly appName: LoggingOptions['appName'];
  // 検証の結果ではなく元の環境を使い続けるため、スキーマの出力の型は問わない
  readonly envSchema: z.ZodType;
}

export function envGuard(options: EnvGuardOptions): MiddlewareHandler {
  const logger = getAppLogger([options.appName, 'http', 'env']);
  return async (c, next) => {
    try {
      validateEnv(options.envSchema, c.env);
    } catch (error) {
      if (!(error instanceof EnvValidationError)) {
        throw error;
      }
      // 属性名に`key`を含めると、属性名による伏せ字の既定の規則で値ごと伏せられる
      logger.error('環境の設定に不備があるため処理を始めません', {
        missingEnvNames: error.missingKeys,
        invalidEnvNames: error.invalidKeys,
      });
      return c.json(
        INTERNAL_ERROR_RESPONSE.body,
        INTERNAL_ERROR_RESPONSE.status,
        INTERNAL_ERROR_RESPONSE.headers,
      );
    }
    await next();
  };
}
