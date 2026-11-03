import { z } from 'zod';

import {
  bindingSchema,
  type PlatformEnv,
  platformEnvShape,
} from '../../lib/workers/env/platform-env.ts';
import { isDeployedEnvironmentValue } from '../../lib/core/env/app-environment.ts';
import type { RateLimitCounter } from '../../lib/workers/rate-limit/rate-limit-counter.ts';
import type { LoginAttemptThrottle } from '../infrastructure/auth/login-attempt-throttle.ts';
import {
  APP_ENVIRONMENTS,
  type AppEnvironment,
} from '../presentation/gateway/gateway-headers.ts';

export interface ApiEnv extends PlatformEnv {
  readonly RATE_LIMIT_COUNTER: DurableObjectNamespace<RateLimitCounter>;
  readonly LOGIN_ATTEMPT_THROTTLE: DurableObjectNamespace<LoginAttemptThrottle>;
  readonly TURNSTILE_SECRET_KEY: string;
  // カンマ区切り。空なら判定結果のホスト名を照合しない
  readonly TURNSTILE_EXPECTED_HOSTNAMES: string;
  readonly APP_ENVIRONMENT: AppEnvironment;
  readonly CLIENT_SITE_ORIGIN: string;
  readonly ADMIN_SITE_ORIGIN: string;
  // ローカル環境だけ省略できる。空文字は未設定として扱う
  readonly DISIFY_API_KEY?: string;
}

// wrangler typesが生成したEnvがapiの環境の型を満たさなければ、ここで型検査が失敗する
type Satisfies<T extends U, U> = T;
export type ApiWorkerEnv = Satisfies<Env, ApiEnv>;

// パス・クエリ・フラグメントを持たないhttp・httpsのオリジンだけを受け付ける
function isOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.origin === value
    );
  } catch {
    return false;
  }
}

export const apiEnvSchema = z
  .object({
    ...platformEnvShape,
    RATE_LIMIT_COUNTER:
      bindingSchema<DurableObjectNamespace<RateLimitCounter>>(),
    LOGIN_ATTEMPT_THROTTLE:
      bindingSchema<DurableObjectNamespace<LoginAttemptThrottle>>(),
    TURNSTILE_SECRET_KEY: z.string().min(1),
    TURNSTILE_EXPECTED_HOSTNAMES: z.string(),
    APP_ENVIRONMENT: z.enum(APP_ENVIRONMENTS),
    CLIENT_SITE_ORIGIN: z.string().refine(isOrigin),
    ADMIN_SITE_ORIGIN: z.string().refine(isOrigin),
    DISIFY_API_KEY: z.string().optional(),
  })
  // デプロイ先の環境でキーの登録を忘れると判定せずに通常として扱い続けるため、起動時に止める。他のキーに不備があっても一緒に報告するよう、環境がオブジェクトなら検査する
  .check(
    z.superRefine(
      (env, context) => {
        if (
          isDeployedEnvironmentValue(env.APP_ENVIRONMENT) &&
          (env.DISIFY_API_KEY === undefined || env.DISIFY_API_KEY === '')
        ) {
          context.addIssue({
            code: 'custom',
            path: ['DISIFY_API_KEY'],
            input: env.DISIFY_API_KEY,
          });
        }
      },
      {
        when: ({ value }) => typeof value === 'object' && value !== null,
      },
    ),
  ) satisfies z.ZodType<ApiEnv>;
