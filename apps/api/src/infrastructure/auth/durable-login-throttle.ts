import type { HashedRateLimitKey } from '../../../lib/core/rate-limit/rate-limit-key.ts';
import type {
  AuthIncidentReporter,
  LoginThrottle,
  LoginThrottleKeys,
  LoginThrottleScope,
} from '../../application/auth/ports.ts';
import type { ThrottleStatus } from '../../domain/auth/login-throttle-state.ts';
import type { LoginAttemptThrottle } from './login-attempt-throttle.ts';

type LoginThrottleUnit = 'email' | 'ip';

const UNLOCKED: ThrottleStatus = Object.freeze({ locked: false });

export function loginThrottleObjectName(
  kind: LoginThrottleUnit,
  scope: LoginThrottleScope,
  key: HashedRateLimitKey,
): string {
  // 送信元IPアドレスの記録は利用者と管理者のログインで共有するため、区分を名前に含めない
  return kind === 'email' ? `login-email:${scope}:${key}` : `login-ip:${key}`;
}

function longestLock(statuses: readonly ThrottleStatus[]): ThrottleStatus {
  return statuses.reduce<ThrottleStatus>((longest, status) => {
    if (!status.locked) {
      return longest;
    }
    return longest.locked &&
      longest.retryAfterSeconds >= status.retryAfterSeconds
      ? longest
      : status;
  }, UNLOCKED);
}

export function createDurableLoginThrottle(
  namespace: DurableObjectNamespace<LoginAttemptThrottle>,
  reporter: AuthIncidentReporter,
): LoginThrottle {
  const stubsFor = (
    scope: LoginThrottleScope,
    keys: LoginThrottleKeys,
  ): DurableObjectStub<LoginAttemptThrottle>[] => {
    const emailName = loginThrottleObjectName('email', scope, keys.email);
    const names =
      keys.ip === undefined
        ? [emailName]
        : [emailName, loginThrottleObjectName('ip', scope, keys.ip)];
    return names.map((name) => namespace.get(namespace.idFromName(name)));
  };

  return {
    async status(scope, keys, now) {
      // 試行ごとに必ず通る確認でだけ通知し、同じ試行の記録や削除で通知を重ねない
      if (keys.ip === undefined) {
        reporter.report({ kind: 'login-throttle-ip-missing' });
      }
      return longestLock(
        await Promise.all(
          stubsFor(scope, keys).map((stub) => stub.status(now.getTime())),
        ),
      );
    },
    async recordFailure(scope, keys, now) {
      return longestLock(
        await Promise.all(
          stubsFor(scope, keys).map((stub) =>
            stub.recordFailure(now.getTime()),
          ),
        ),
      );
    },
    async reset(scope, keys) {
      await Promise.all(stubsFor(scope, keys).map((stub) => stub.reset()));
    },
  };
}
