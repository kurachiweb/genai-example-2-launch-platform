import { z } from 'zod';

import {
  bindingSchema,
  type PlatformEnv,
  platformEnvShape,
} from '../../lib/workers/env/platform-env.ts';
import type { RateLimitCounter } from '../../lib/workers/rate-limit/rate-limit-counter.ts';

const APP_ENVIRONMENT_VALUES = ['local', 'staging', 'prod'] as const;

export interface ApiEnv extends PlatformEnv {
  readonly RATE_LIMIT_COUNTER: DurableObjectNamespace<RateLimitCounter>;
  readonly TURNSTILE_SECRET_KEY: string;
  // カンマ区切り。空なら判定結果のホスト名を照合しない
  readonly TURNSTILE_EXPECTED_HOSTNAMES: string;
  readonly APP_ENVIRONMENT: (typeof APP_ENVIRONMENT_VALUES)[number];
}

// wrangler typesが生成したEnvがapiの環境の型を満たさなければ、ここで型検査が失敗する
type Satisfies<T extends U, U> = T;
export type ApiWorkerEnv = Satisfies<Env, ApiEnv>;

export const apiEnvSchema = z.object({
  ...platformEnvShape,
  RATE_LIMIT_COUNTER: bindingSchema<DurableObjectNamespace<RateLimitCounter>>(),
  TURNSTILE_SECRET_KEY: z.string().min(1),
  TURNSTILE_EXPECTED_HOSTNAMES: z.string(),
  APP_ENVIRONMENT: z.enum(APP_ENVIRONMENT_VALUES),
}) satisfies z.ZodType<ApiEnv>;
