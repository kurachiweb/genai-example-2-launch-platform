import { inject, injectable } from 'inversify';

import {
  DATA_EXPORT_REQUEST_LIMIT,
  DATA_EXPORT_REQUEST_WINDOW_SECONDS,
} from '../../../common-lib/data-export/data-export-rules.ts';
import type { KeyedHasher } from '../../../lib/core/crypto/keyed-hasher.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { CounterRule } from '../../../lib/core/rate-limit/fixed-window.ts';
import { hashRateLimitKey } from '../../../lib/core/rate-limit/rate-limit-key.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type { RateLimitCounterClient } from '../../../lib/workers/rate-limit/rate-limit-counter-client.ts';
import type { DataExportRequestLimits } from '../../application/data-export/data-export-request-ports.ts';

export const DATA_EXPORT_REQUEST_RULE = Object.freeze({
  name: 'data-export-request',
  limit: DATA_EXPORT_REQUEST_LIMIT,
  windowSeconds: DATA_EXPORT_REQUEST_WINDOW_SECONDS,
} as const satisfies CounterRule);

const KEY_PURPOSE = 'data-export';

@injectable()
export class CounterDataExportRequestLimits implements DataExportRequestLimits {
  constructor(
    @inject(PLATFORM_TYPES.RateLimitCounterClient)
    private readonly counters: RateLimitCounterClient,
    @inject(PLATFORM_TYPES.KeyedHasher)
    private readonly hasher: KeyedHasher,
    @inject(PLATFORM_TYPES.Clock)
    private readonly clock: Clock,
  ) {}

  async consume(userId: string): Promise<void> {
    const key = await hashRateLimitKey(this.hasher, KEY_PURPOSE, userId);
    const decision = await this.counters.hit(DATA_EXPORT_REQUEST_RULE, key);
    this.counters.assertWithinLimit(decision, this.clock.now().getTime());
  }
}
