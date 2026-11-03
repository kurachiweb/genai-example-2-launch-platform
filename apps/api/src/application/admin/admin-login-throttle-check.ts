import {
  checkLoginThrottle,
  type LoginThrottleCheckDependencies,
} from '../auth/login-throttle-check.ts';
import type { LoginThrottleKeys, LoginThrottleScope } from '../auth/ports.ts';
import type { AdminRequestMeta } from './ports.ts';

// メールアドレス単位の記録は利用者と分かれ、IPアドレス単位の記録は主体の種類を問わず共有される
export const ADMIN_LOGIN_THROTTLE_SCOPE: LoginThrottleScope = 'admin';

export const checkAdminLoginThrottle = (
  dependencies: LoginThrottleCheckDependencies,
  email: string,
  meta: AdminRequestMeta,
): Promise<LoginThrottleKeys> =>
  checkLoginThrottle(dependencies, ADMIN_LOGIN_THROTTLE_SCOPE, email, meta);
