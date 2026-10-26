export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelaySeconds: number;
  readonly maxDelaySeconds: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 5,
  baseDelaySeconds: 30,
  maxDelaySeconds: 3600,
});

// 本体Queueのconsumerの`max_retries`(Wrangler設定)と一致させる。一致は設定の整合の単体テストで確かめる
export const QUEUE_MAX_RETRIES = 6;

// Queuesは`max_retries`+1回まで配信する。上限を`max_retries`以下に抑え、最後の試行で通知の送信に失敗しても再配信で送り直せるようにする
export function assertRetryPolicy(policy: RetryPolicy): void {
  const { maxAttempts } = policy;
  if (
    !Number.isInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > QUEUE_MAX_RETRIES
  ) {
    throw new RangeError(
      `試行回数の上限は1以上${String(QUEUE_MAX_RETRIES)}以下の整数で指定してください: ${String(maxAttempts)}`,
    );
  }
}

export type FailureDecision =
  | { readonly kind: 'retry'; readonly delaySeconds: number }
  | { readonly kind: 'dead-letter' };

export function decideOnFailure(
  policy: RetryPolicy,
  attempts: number,
): FailureDecision {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new RangeError(
      `試行回数は1以上の整数で指定してください: ${String(attempts)}`,
    );
  }
  if (attempts >= policy.maxAttempts) {
    return { kind: 'dead-letter' };
  }
  return {
    kind: 'retry',
    delaySeconds: Math.min(
      policy.baseDelaySeconds * 2 ** (attempts - 1),
      policy.maxDelaySeconds,
    ),
  };
}
