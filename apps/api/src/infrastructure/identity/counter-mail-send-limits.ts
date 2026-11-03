import { inject, injectable } from 'inversify';

import type { KeyedHasher } from '../../../lib/core/crypto/keyed-hasher.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { toMatchingKey } from '../../../lib/core/email/email-address.ts';
import type {
  CounterDecision,
  CounterRule,
} from '../../../lib/core/rate-limit/fixed-window.ts';
import { hashRateLimitKey } from '../../../lib/core/rate-limit/rate-limit-key.ts';
import type { RateLimitCounterClient } from '../../../lib/workers/rate-limit/rate-limit-counter-client.ts';
import { MAIL_SEND_POLICY } from '../../application/auth/mail-send-policy.ts';
import type {
  LimitedMailKind,
  MailSendLimits,
} from '../../application/identity/ports.ts';
import type { RequestMeta } from '../../application/identity/request-meta.ts';

interface MailSendRules {
  readonly address: CounterRule;
  readonly ip: CounterRule;
}

const rulesFor = (kind: LimitedMailKind): MailSendRules => ({
  address: {
    name: `auth-mail:${kind}:address`,
    limit: MAIL_SEND_POLICY.limitPerAddress,
    windowSeconds: MAIL_SEND_POLICY.windowSeconds,
  },
  ip: {
    name: `auth-mail:${kind}:ip`,
    limit: MAIL_SEND_POLICY.limitPerIp,
    windowSeconds: MAIL_SEND_POLICY.windowSeconds,
  },
});

const latestReset = (
  rejected: readonly CounterDecision[],
): CounterDecision | undefined =>
  rejected.reduce<CounterDecision | undefined>(
    (latest, decision) =>
      latest === undefined || decision.resetAt > latest.resetAt
        ? decision
        : latest,
    undefined,
  );

@injectable()
export class CounterMailSendLimits implements MailSendLimits {
  constructor(
    @inject(PLATFORM_TYPES.RateLimitCounterClient)
    private readonly counters: RateLimitCounterClient,
    @inject(PLATFORM_TYPES.KeyedHasher)
    private readonly hasher: KeyedHasher,
  ) {}

  async consume(
    kind: LimitedMailKind,
    address: string,
    meta: RequestMeta,
  ): Promise<void> {
    const rules = rulesFor(kind);
    const [addressKey, ipKey] = await Promise.all([
      hashRateLimitKey(this.hasher, toMatchingKey(address)),
      // 不明なIPアドレスを1つのキーで数えると、無関係な利用者の送信までまとめて止まる
      meta.clientIp === undefined || meta.clientIp === ''
        ? undefined
        : hashRateLimitKey(this.hasher, meta.clientIp),
    ]);
    // 片方が超過しても両方を数え、宛先とIPアドレスのどちらの記録も要求の回数と食い違わないようにする
    const decisions = await Promise.all([
      this.counters.hit(rules.address, addressKey),
      ...(ipKey === undefined ? [] : [this.counters.hit(rules.ip, ipKey)]),
    ]);
    const rejected = latestReset(
      decisions.filter((decision) => !decision.allowed),
    );
    if (rejected !== undefined) {
      this.counters.assertWithinLimit(rejected, meta.now.getTime());
    }
  }
}
