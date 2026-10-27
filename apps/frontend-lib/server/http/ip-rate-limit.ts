import type { RateLimiter } from '../env/frontend-env.ts';

export const IP_RATE_LIMIT = Object.freeze({
  limit: 100,
  periodSeconds: 10,
  keyPrefix: 'ip:',
  unknownClient: 'unknown',
} as const);

export type RateLimitOutcome =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly retryAfterSeconds: typeof IP_RATE_LIMIT.periodSeconds;
    };

export interface IpRateLimitLogger {
  warn(message: string, properties: Readonly<Record<string, unknown>>): void;
}

export function ipRateLimitKey(clientIp: string | undefined): string {
  return `${IP_RATE_LIMIT.keyPrefix}${clientIp ?? IP_RATE_LIMIT.unknownClient}`;
}

export async function checkIpRateLimit(
  limiter: RateLimiter,
  clientIp: string | undefined,
  logger: IpRateLimitLogger,
): Promise<RateLimitOutcome> {
  try {
    const { success } = await limiter.limit({ key: ipRateLimitKey(clientIp) });
    return success
      ? { allowed: true }
      : { allowed: false, retryAfterSeconds: IP_RATE_LIMIT.periodSeconds };
  } catch (error) {
    // 実行基盤の一時的な障害でサイト全体を止めないため、判定できない要求は通す
    logger.warn('IP制限の判定に失敗したため要求を通しました', { error });
    return { allowed: true };
  }
}
