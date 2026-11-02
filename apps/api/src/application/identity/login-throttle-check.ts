import type { KeyedHasher } from '../../../lib/core/crypto/keyed-hasher.ts';
import { createLoginThrottleKeys } from '../auth/login-throttle-keys.ts';
import type {
  LoginThrottle,
  LoginThrottleKeys,
  LoginThrottleScope,
} from '../auth/ports.ts';
import { loginThrottledError } from './identity-errors.ts';
import type { RequestMeta } from './request-meta.ts';

export const USER_LOGIN_THROTTLE_SCOPE: LoginThrottleScope = 'user';

export interface LoginThrottleCheckDependencies {
  readonly keyedHasher: KeyedHasher;
  readonly throttle: LoginThrottle;
}

// IPアドレスが不明な要求の通知はstatusの時だけ行われるため、照合より前に必ず呼ぶ
export async function checkUserLoginThrottle(
  dependencies: LoginThrottleCheckDependencies,
  email: string,
  meta: RequestMeta,
): Promise<LoginThrottleKeys> {
  const keys = await createLoginThrottleKeys(
    dependencies.keyedHasher,
    email,
    meta.clientIp,
  );
  const status = await dependencies.throttle.status(
    USER_LOGIN_THROTTLE_SCOPE,
    keys,
    meta.now,
  );
  if (status.locked) {
    throw loginThrottledError(status.retryAfterSeconds);
  }
  return keys;
}
