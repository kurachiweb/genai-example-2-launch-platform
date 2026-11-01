import type { RateLimitExclusion } from '../../lib/workers/rate-limit/exclusions.ts';
import { isImageDeliveryRequest } from '../presentation/media/image-request-match.ts';
import type { EventEnv } from './env-schema.ts';

// 画像配信のホストへの画像の要求はエッジキャッシュの後ろで配信するため、Worker単位のIP制限で数えない
export const RATE_LIMIT_EXCLUSIONS: readonly RateLimitExclusion<EventEnv>[] =
  Object.freeze([isImageDeliveryRequest]);
