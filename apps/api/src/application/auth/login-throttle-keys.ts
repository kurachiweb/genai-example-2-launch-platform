import type { KeyedHasher } from '../../../lib/core/crypto/keyed-hasher.ts';
import { toMatchingKey } from '../../../lib/core/email/email-address.ts';
import { hashRateLimitKey } from '../../../lib/core/rate-limit/rate-limit-key.ts';
import type { LoginThrottleKeys } from './ports.ts';

export async function createLoginThrottleKeys(
  hasher: KeyedHasher,
  email: string,
  clientIp: string | undefined,
): Promise<LoginThrottleKeys> {
  const [emailKey, ipKey] = await Promise.all([
    hashRateLimitKey(hasher, toMatchingKey(email)),
    // 不明なIPアドレスを1つのキーで数えると、全員の失敗が同じ記録に集まって無関係な利用者までロックされる
    clientIp === undefined || clientIp === ''
      ? undefined
      : hashRateLimitKey(hasher, clientIp),
  ]);
  return { email: emailKey, ip: ipKey };
}
