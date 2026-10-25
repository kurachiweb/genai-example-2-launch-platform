import type { RateLimitExclusion } from '../../lib/workers/rate-limit/exclusions.ts';
import type { EventEnv } from './env-schema.ts';

export const RATE_LIMIT_EXCLUSIONS: readonly RateLimitExclusion<EventEnv>[] =
  Object.freeze([]);
