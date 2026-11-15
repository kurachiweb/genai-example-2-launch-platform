import { inject, injectable } from 'inversify';

import type { KeyedHasher } from '../../../lib/core/crypto/keyed-hasher.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type { CounterRule } from '../../../lib/core/rate-limit/fixed-window.ts';
import { hashRateLimitKey } from '../../../lib/core/rate-limit/rate-limit-key.ts';
import type { RateLimitCounterClient } from '../../../lib/workers/rate-limit/rate-limit-counter-client.ts';
import type { GuestInquiryRateLimit } from '../../application/inquiry/ports.ts';

export const GUEST_INQUIRY_RATE_RULE = Object.freeze({
  name: 'inquiry-guest:ip',
  limit: 5,
  windowSeconds: 3600,
} as const satisfies CounterRule);

const KEY_PURPOSE = 'inquiry-guest';

const logger = getAppLogger(['api', 'inquiry', 'guest-rate-limit']);

@injectable()
export class CounterGuestInquiryRateLimit implements GuestInquiryRateLimit {
  constructor(
    @inject(PLATFORM_TYPES.RateLimitCounterClient)
    private readonly counters: RateLimitCounterClient,
    @inject(PLATFORM_TYPES.KeyedHasher)
    private readonly hasher: KeyedHasher,
  ) {}

  async consume(clientIp: string | undefined, now: Date): Promise<void> {
    // 不明なIPアドレスを1つのキーで数えると無関係な送信までまとめて止まるため、数えずにbot判定で守る
    if (clientIp === undefined || clientIp === '') {
      logger.warn(
        '送信元IPアドレスが不明なため、未ログインの問い合わせの送信回数を数えませんでした',
        { reason: 'guest-inquiry-ip-missing' },
      );
      return;
    }
    const key = await hashRateLimitKey(this.hasher, KEY_PURPOSE, clientIp);
    const decision = await this.counters.hit(GUEST_INQUIRY_RATE_RULE, key);
    this.counters.assertWithinLimit(decision, now.getTime());
  }
}
