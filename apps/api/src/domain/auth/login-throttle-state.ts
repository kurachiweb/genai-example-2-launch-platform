export interface LoginThrottleState {
  readonly failures: number;
  readonly lockedUntil: number | undefined;
  readonly lastFailureAt: number;
}

export const LOGIN_FREE_ATTEMPTS = 5;

export const LOGIN_BASE_COOLDOWN_MS = 1000;

export const LOGIN_MAX_COOLDOWN_MS = 300_000;

export const LOGIN_FAILURE_RETENTION_MS = 86_400_000;

export type ThrottleStatus =
  | { readonly locked: false }
  | { readonly locked: true; readonly retryAfterSeconds: number };

export interface FailureResult {
  readonly next: LoginThrottleState;
  readonly status: ThrottleStatus;
  readonly alarmAt: number;
}

export type AlarmOutcome =
  | { readonly kind: 'clear' }
  | {
      readonly kind: 'unlock';
      readonly next: LoginThrottleState;
      readonly alarmAt: number;
    }
  | { readonly kind: 'reschedule'; readonly alarmAt: number };

const MS_PER_SECOND = 1000;

const UNLOCKED: ThrottleStatus = Object.freeze({ locked: false });

export const cooldownMs = (failures: number): number => {
  if (failures <= LOGIN_FREE_ATTEMPTS) {
    return 0;
  }
  return Math.min(
    LOGIN_BASE_COOLDOWN_MS * 2 ** (failures - LOGIN_FREE_ATTEMPTS - 1),
    LOGIN_MAX_COOLDOWN_MS,
  );
};

const retentionEndsAt = (state: LoginThrottleState): number =>
  state.lastFailureAt + LOGIN_FAILURE_RETENTION_MS;

const liveState = (
  state: LoginThrottleState | undefined,
  now: number,
): LoginThrottleState | undefined =>
  state === undefined || now >= retentionEndsAt(state) ? undefined : state;

const activeLockUntil = (
  state: LoginThrottleState | undefined,
  now: number,
): number | undefined => {
  const lockedUntil = state?.lockedUntil;
  return lockedUntil !== undefined && lockedUntil > now
    ? lockedUntil
    : undefined;
};

const lockedStatus = (lockedUntil: number, now: number): ThrottleStatus => ({
  locked: true,
  retryAfterSeconds: Math.ceil((lockedUntil - now) / MS_PER_SECOND),
});

export const currentStatus = (
  state: LoginThrottleState | undefined,
  now: number,
): ThrottleStatus => {
  const lockedUntil = activeLockUntil(liveState(state, now), now);
  return lockedUntil === undefined ? UNLOCKED : lockedStatus(lockedUntil, now);
};

export const applyFailure = (
  state: LoginThrottleState | undefined,
  now: number,
): FailureResult => {
  const live = liveState(state, now);
  const currentLock = activeLockUntil(live, now);
  // 照合を始めた後にほかの要求がロックした場合も、ロック中の試行として数えない
  if (live !== undefined && currentLock !== undefined) {
    return {
      next: live,
      status: lockedStatus(currentLock, now),
      alarmAt: currentLock,
    };
  }
  const failures = (live?.failures ?? 0) + 1;
  const cooldown = cooldownMs(failures);
  const lockedUntil = cooldown > 0 ? now + cooldown : undefined;
  const next: LoginThrottleState = {
    failures,
    lockedUntil,
    lastFailureAt: now,
  };
  return {
    next,
    status:
      lockedUntil === undefined ? UNLOCKED : lockedStatus(lockedUntil, now),
    alarmAt: Math.min(lockedUntil ?? Infinity, retentionEndsAt(next)),
  };
};

export const alarmOutcome = (
  state: LoginThrottleState,
  now: number,
): AlarmOutcome => {
  if (liveState(state, now) === undefined) {
    return { kind: 'clear' };
  }
  const { lockedUntil } = state;
  if (lockedUntil === undefined) {
    return { kind: 'reschedule', alarmAt: retentionEndsAt(state) };
  }
  if (lockedUntil <= now) {
    return {
      kind: 'unlock',
      next: { ...state, lockedUntil: undefined },
      alarmAt: retentionEndsAt(state),
    };
  }
  return {
    kind: 'reschedule',
    alarmAt: Math.min(lockedUntil, retentionEndsAt(state)),
  };
};
