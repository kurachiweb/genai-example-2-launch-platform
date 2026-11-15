import {
  checkLoginThrottle,
  type LoginThrottleCheckDependencies,
} from '../auth/login-throttle-check.ts';
import type { LoginThrottleKeys, LoginThrottleScope } from '../auth/ports.ts';
import type { RequestMeta } from './request-meta.ts';

export type { LoginThrottleCheckDependencies } from '../auth/login-throttle-check.ts';

export const USER_LOGIN_THROTTLE_SCOPE: LoginThrottleScope = 'user';

export const checkUserLoginThrottle = (
  dependencies: LoginThrottleCheckDependencies,
  email: string,
  meta: RequestMeta,
): Promise<LoginThrottleKeys> =>
  checkLoginThrottle(dependencies, USER_LOGIN_THROTTLE_SCOPE, email, meta);
