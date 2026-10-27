import {
  decideOnFailure,
  type RetryPolicy,
} from '../messaging/retry-policy.ts';
import type { EmailProviderOutcome } from './provider-outcome.ts';

// 試行回数の上限をQueuesの`max_retries`より小さくし、デッドレターへの自動の移送より先に送信不能を判断する
export const EMAIL_SEND_RETRY_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 5,
  baseDelaySeconds: 120,
  maxDelaySeconds: 3600,
});

export const RATE_LIMIT_DEFER_SECONDS = 60;

// 日次上限のリセット時刻は公開されていないため、時刻を計算せず一定の間隔で試し直す
export const DAILY_LIMIT_DEFER_SECONDS = 3600;

export type PreSendDecision =
  | { readonly kind: 'proceed' }
  | { readonly kind: 'skip'; readonly reason: 'expired' };

export function decideBeforeSend(
  deadline: Date | undefined,
  now: Date,
): PreSendDecision {
  if (deadline !== undefined && now.getTime() >= deadline.getTime()) {
    return { kind: 'skip', reason: 'expired' };
  }
  return { kind: 'proceed' };
}

export type DeliveryAction =
  | { readonly kind: 'completed'; readonly providerMessageId: string }
  | {
      readonly kind: 'defer';
      readonly delaySeconds: number;
      readonly cause: 'rate-limited' | 'daily-limit';
    }
  | { readonly kind: 'retry'; readonly code: string }
  | {
      readonly kind: 'give-up';
      readonly result:
        'undeliverable' | 'recipient-suppressed' | 'recipient-not-allowed';
      readonly code: string | undefined;
      readonly report: boolean;
    };

// 再試行の間隔は、この判定でretryになった後にbackend-platformの受信部が同じ方針でdecideOnFailureから求める
export function decideAfterOutcome(
  outcome: EmailProviderOutcome,
  attempts: number,
  policy: RetryPolicy = EMAIL_SEND_RETRY_POLICY,
): DeliveryAction {
  const failure = decideOnFailure(policy, attempts);
  switch (outcome.kind) {
    case 'sent':
      return {
        kind: 'completed',
        providerMessageId: outcome.providerMessageId,
      };
    case 'rate-limited':
      return {
        kind: 'defer',
        delaySeconds: RATE_LIMIT_DEFER_SECONDS,
        cause: 'rate-limited',
      };
    case 'daily-limit':
      return {
        kind: 'defer',
        delaySeconds: DAILY_LIMIT_DEFER_SECONDS,
        cause: 'daily-limit',
      };
    case 'temporary':
      return failure.kind === 'retry'
        ? { kind: 'retry', code: outcome.code }
        : undeliverable(outcome.code);
    case 'permanent':
      return undeliverable(outcome.code);
    case 'recipient-suppressed':
    case 'recipient-not-allowed':
      return {
        kind: 'give-up',
        result: outcome.kind,
        code: undefined,
        report: false,
      };
  }
}

function undeliverable(code: string): DeliveryAction {
  return { kind: 'give-up', result: 'undeliverable', code, report: true };
}
