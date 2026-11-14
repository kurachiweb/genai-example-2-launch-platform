import { inject, injectable } from 'inversify';

import type { KeyedHasher } from '../../../lib/core/crypto/keyed-hasher.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { RateLimitCounterClient } from '../../../lib/workers/rate-limit/rate-limit-counter-client.ts';
import type {
  LimitedMailKind,
  MailSendLimits,
} from '../../application/identity/ports.ts';
import type { RequestMeta } from '../../application/identity/request-meta.ts';
import { consumeMailSendCounters } from '../auth/mail-send-counters.ts';

const USER_MAIL_RULE_PREFIX = 'auth-mail';

@injectable()
export class CounterMailSendLimits implements MailSendLimits {
  constructor(
    @inject(PLATFORM_TYPES.RateLimitCounterClient)
    private readonly counters: RateLimitCounterClient,
    @inject(PLATFORM_TYPES.KeyedHasher)
    private readonly hasher: KeyedHasher,
  ) {}

  consume(
    kind: LimitedMailKind,
    address: string,
    meta: RequestMeta,
  ): Promise<void> {
    return consumeMailSendCounters(
      { counters: this.counters, hasher: this.hasher },
      {
        rulePrefix: USER_MAIL_RULE_PREFIX,
        kind,
        address,
        clientIp: meta.clientIp,
        now: meta.now,
      },
    );
  }
}
