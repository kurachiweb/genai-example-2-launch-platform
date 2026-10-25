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
