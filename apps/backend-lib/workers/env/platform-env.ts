import { z } from 'zod';

import { LOG_LEVELS, type LogLevel } from '../../core/logging/log-level.ts';
import type { QueueEnvelope } from '../../core/messaging/envelope.ts';

export interface PlatformEnv {
  readonly DB: D1Database;
  readonly IMAGES_BUCKET: R2Bucket;
  readonly FILES_BUCKET: R2Bucket;
  readonly QUARANTINE_BUCKET: R2Bucket;
  readonly JOBS_QUEUE: Queue<QueueEnvelope>;
  readonly IP_RATE_LIMITER: RateLimit;
  readonly HASH_PEPPER: string;
  readonly LOG_LEVEL: LogLevel;
  readonly SENTRY_ENVIRONMENT: string;
  readonly SENTRY_TRACES_SAMPLE_RATE: string;
  readonly SENTRY_DSN?: string;
}

// 0以上1以下の10進表記だけを受け付ける。Number()は空文字列・16進・指数表記も数値にするため使わない
const SAMPLE_RATE_PATTERN = /^(?:0(?:\.\d+)?|1(?:\.0+)?)$/;

// バインディングの実体はworkerdが注入するため、存在とオブジェクトであることだけを確かめる
export function bindingSchema<T>(): z.ZodCustom<T> {
  return z.custom<T>((value) => typeof value === 'object' && value !== null);
}

export const platformEnvShape = {
  DB: bindingSchema<D1Database>(),
  IMAGES_BUCKET: bindingSchema<R2Bucket>(),
  FILES_BUCKET: bindingSchema<R2Bucket>(),
  QUARANTINE_BUCKET: bindingSchema<R2Bucket>(),
  JOBS_QUEUE: bindingSchema<Queue<QueueEnvelope>>(),
  IP_RATE_LIMITER: bindingSchema<RateLimit>(),
  HASH_PEPPER: z.string().min(1),
  LOG_LEVEL: z.enum(LOG_LEVELS),
  SENTRY_ENVIRONMENT: z.string().min(1),
  SENTRY_TRACES_SAMPLE_RATE: z.string().regex(SAMPLE_RATE_PATTERN),
  SENTRY_DSN: z.string().optional(),
} satisfies z.ZodRawShape;
