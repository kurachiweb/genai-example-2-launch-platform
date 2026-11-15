import type { KeyedHasher } from '../../../lib/core/crypto/keyed-hasher.ts';
import { toMatchingKey } from '../../../lib/core/email/email-address.ts';
import type {
  CounterDecision,
  CounterRule,
} from '../../../lib/core/rate-limit/fixed-window.ts';
import { hashRateLimitKey } from '../../../lib/core/rate-limit/rate-limit-key.ts';
import type { RateLimitCounterClient } from '../../../lib/workers/rate-limit/rate-limit-counter-client.ts';
import { MAIL_SEND_POLICY } from '../../application/auth/mail-send-policy.ts';

export interface MailSendCounterDependencies {
  readonly counters: RateLimitCounterClient;
  readonly hasher: KeyedHasher;
}

export interface MailSendCounterRequest {
  // 主体の種類ごとに規則の名前を分け、同じメールアドレスを別の主体で使っても互いの送信回数に数えない
  readonly rulePrefix: string;
  readonly kind: string;
  readonly address: string;
  readonly clientIp: string | undefined;
  readonly now: Date;
}

interface MailSendRules {
  readonly address: CounterRule;
  readonly ip: CounterRule;
}

const rulesFor = (rulePrefix: string, kind: string): MailSendRules => ({
  address: {
    name: `${rulePrefix}:${kind}:address`,
    limit: MAIL_SEND_POLICY.limitPerAddress,
    windowSeconds: MAIL_SEND_POLICY.windowSeconds,
  },
  ip: {
    name: `${rulePrefix}:${kind}:ip`,
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

// 宛先とIPアドレスの単位で数え、どちらかが上限を超えたらAppError(rate_limited, rate_limit_exceeded)を投げる
export async function consumeMailSendCounters(
  { counters, hasher }: MailSendCounterDependencies,
  request: MailSendCounterRequest,
): Promise<void> {
  const rules = rulesFor(request.rulePrefix, request.kind);
  const { clientIp } = request;
  const [addressKey, ipKey] = await Promise.all([
    hashRateLimitKey(hasher, toMatchingKey(request.address)),
    // 不明なIPアドレスを1つのキーで数えると、無関係な送信までまとめて止まる
    clientIp === undefined || clientIp === ''
      ? undefined
      : hashRateLimitKey(hasher, clientIp),
  ]);
  // 片方が超過しても両方を数え、宛先とIPアドレスのどちらの記録も要求の回数と食い違わないようにする
  const decisions = await Promise.all([
    counters.hit(rules.address, addressKey),
    ...(ipKey === undefined ? [] : [counters.hit(rules.ip, ipKey)]),
  ]);
  const rejected = latestReset(
    decisions.filter((decision) => !decision.allowed),
  );
  if (rejected !== undefined) {
    counters.assertWithinLimit(rejected, request.now.getTime());
  }
}
