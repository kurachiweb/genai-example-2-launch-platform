import { inject, injectable } from 'inversify';

import type { KeyedHasher } from '../../../lib/core/crypto/keyed-hasher.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { RateLimitCounterClient } from '../../../lib/workers/rate-limit/rate-limit-counter-client.ts';
import type {
  AdminLimitedMailKind,
  AdminMailSendLimits,
  AdminRequestMeta,
} from '../../application/admin/ports.ts';
import { consumeMailSendCounters } from '../auth/mail-send-counters.ts';

const ADMIN_MAIL_RULE_PREFIX = 'admin-auth-mail';

@injectable()
export class CounterAdminMailSendLimits implements AdminMailSendLimits {
  constructor(
    @inject(PLATFORM_TYPES.RateLimitCounterClient)
    private readonly counters: RateLimitCounterClient,
    @inject(PLATFORM_TYPES.KeyedHasher)
    private readonly hasher: KeyedHasher,
  ) {}

  consume(
    kind: AdminLimitedMailKind,
    address: string,
    meta: AdminRequestMeta,
  ): Promise<void> {
    return consumeMailSendCounters(
      { counters: this.counters, hasher: this.hasher },
      {
        rulePrefix: ADMIN_MAIL_RULE_PREFIX,
        kind,
        address,
        clientIp: meta.clientIp,
        now: meta.now,
      },
    );
  }
}
