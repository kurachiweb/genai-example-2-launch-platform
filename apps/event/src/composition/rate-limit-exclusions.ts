import {
  excludePath,
  type RateLimitExclusion,
} from '../../lib/workers/rate-limit/exclusions.ts';
import { isImageDeliveryRequest } from '../presentation/media/image-request-match.ts';
import { STRIPE_WEBHOOK_PATH } from '../presentation/payments/stripe-webhook-route.ts';
import type { EventEnv } from './env-schema.ts';

// エッジキャッシュの後ろで配信する画像配信のホストへの画像の要求と、署名の検証で送り手を確かめるStripeのWebhookは、Worker単位のIP制限で数えない
export const RATE_LIMIT_EXCLUSIONS: readonly RateLimitExclusion<EventEnv>[] =
  Object.freeze([
    isImageDeliveryRequest,
    excludePath<EventEnv>(STRIPE_WEBHOOK_PATH, 'POST'),
  ]);
