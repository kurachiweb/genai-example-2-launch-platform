export interface PortalSessionLimits {
  // 超過はAppError(rate_limited, rate_limit_exceeded, retryAfterSeconds)
  consume(userId: string, now: Date): Promise<void>;
}
