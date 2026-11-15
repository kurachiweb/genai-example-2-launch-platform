import type { SessionPolicy } from '../auth/session-policy.ts';

export const ADMIN_SESSION_POLICY: SessionPolicy = Object.freeze({
  idleSeconds: 60 * 60,
  absoluteSeconds: 12 * 60 * 60,
  touchIntervalSeconds: 5 * 60,
});
