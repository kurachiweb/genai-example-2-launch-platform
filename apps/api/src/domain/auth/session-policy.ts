export interface SessionPolicy {
  readonly idleSeconds: number;
  readonly absoluteSeconds: number;
  readonly touchIntervalSeconds: number;
}

export const USER_SESSION_POLICY: SessionPolicy = Object.freeze({
  idleSeconds: 14 * 24 * 60 * 60,
  absoluteSeconds: 90 * 24 * 60 * 60,
  touchIntervalSeconds: 15 * 60,
});

export interface SessionTimes {
  readonly createdAt: Date;
  readonly lastUsedAt: Date;
  readonly absoluteExpiresAt: Date;
}

export type SessionEvaluation =
  | { readonly status: 'expired' }
  | {
      readonly status: 'active';
      readonly touch: boolean;
      readonly maxAgeSeconds: number;
    };

const MS_PER_SECOND = 1000;

const MIN_COOKIE_MAX_AGE_SECONDS = 1;

const idleExpiresAtMs = (lastUsedAt: Date, policy: SessionPolicy): number =>
  lastUsedAt.getTime() + policy.idleSeconds * MS_PER_SECOND;

export const newSessionTimes = (
  now: Date,
  policy: SessionPolicy,
): SessionTimes => ({
  createdAt: new Date(now),
  lastUsedAt: new Date(now),
  absoluteExpiresAt: new Date(
    now.getTime() + policy.absoluteSeconds * MS_PER_SECOND,
  ),
});

// 端数を切り捨てるのは、Cookieをサーバー側のセッションより長く残さないため
export const cookieMaxAgeSeconds = (
  times: SessionTimes,
  now: Date,
  policy: SessionPolicy,
): number => {
  const remainingMs =
    Math.min(
      idleExpiresAtMs(times.lastUsedAt, policy),
      times.absoluteExpiresAt.getTime(),
    ) - now.getTime();
  return Math.max(
    MIN_COOKIE_MAX_AGE_SECONDS,
    Math.floor(remainingMs / MS_PER_SECOND),
  );
};

export const evaluateSession = (
  times: SessionTimes,
  now: Date,
  policy: SessionPolicy,
): SessionEvaluation => {
  const nowMs = now.getTime();
  if (
    nowMs >= idleExpiresAtMs(times.lastUsedAt, policy) ||
    nowMs >= times.absoluteExpiresAt.getTime()
  ) {
    return { status: 'expired' };
  }
  const touch =
    nowMs - times.lastUsedAt.getTime() >=
    policy.touchIntervalSeconds * MS_PER_SECOND;
  const effectiveTimes = touch ? { ...times, lastUsedAt: now } : times;
  return {
    status: 'active',
    touch,
    maxAgeSeconds: cookieMaxAgeSeconds(effectiveTimes, now, policy),
  };
};
