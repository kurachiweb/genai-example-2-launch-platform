import type { KeyedHasher } from '../../../lib/core/crypto/keyed-hasher.ts';
import { loginThrottledError } from './auth-errors.ts';
import { createLoginThrottleKeys } from './login-throttle-keys.ts';
import type {
  LoginThrottle,
  LoginThrottleKeys,
  LoginThrottleScope,
} from './ports.ts';

export interface LoginThrottleCheckDependencies {
  readonly keyedHasher: KeyedHasher;
  readonly throttle: LoginThrottle;
}

export interface LoginAttemptMeta {
  readonly clientIp: string | undefined;
  readonly now: Date;
}

// IPアドレスが不明な要求の通知はstatusの時だけ行われるため、照合より前に必ず呼ぶ
export async function checkLoginThrottle(
  dependencies: LoginThrottleCheckDependencies,
  scope: LoginThrottleScope,
  email: string,
  meta: LoginAttemptMeta,
): Promise<LoginThrottleKeys> {
  const keys = await createLoginThrottleKeys(
    dependencies.keyedHasher,
    email,
    meta.clientIp,
  );
  const status = await dependencies.throttle.status(scope, keys, meta.now);
  if (status.locked) {
    throw loginThrottledError(status.retryAfterSeconds);
  }
  return keys;
}
