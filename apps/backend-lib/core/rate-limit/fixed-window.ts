export interface CounterRule {
  readonly name: string;
  readonly limit: number;
  readonly windowSeconds: number;
}

export interface WindowState {
  readonly count: number;
  readonly windowStartedAt: number;
  readonly windowSeconds: number;
}

export interface CounterDecision {
  readonly allowed: boolean;
  readonly count: number;
  readonly remaining: number;
  readonly resetAt: number;
}

export interface HitOutcome {
  readonly next: WindowState | undefined;
  readonly decision: CounterDecision;
  readonly scheduleAlarmAt: number | undefined;
}

const MILLISECONDS_PER_SECOND = 1000;

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 1;
}

function assertValidInput(now: number, rule: CounterRule): void {
  if (!isPositiveInteger(rule.limit)) {
    throw new RangeError(
      `上限回数は1以上の整数で指定してください: ${String(rule.limit)}`,
    );
  }
  if (!isPositiveInteger(rule.windowSeconds)) {
    throw new RangeError(
      `期間の秒数は1以上の整数で指定してください: ${String(rule.windowSeconds)}`,
    );
  }
  if (!Number.isFinite(now)) {
    throw new RangeError(
      `現在時刻は有限の数で指定してください: ${String(now)}`,
    );
  }
}

export function windowEndsAt(state: WindowState): number {
  return state.windowStartedAt + state.windowSeconds * MILLISECONDS_PER_SECOND;
}

function startWindow(now: number, rule: CounterRule): HitOutcome {
  const next: WindowState = {
    count: 1,
    windowStartedAt: now,
    windowSeconds: rule.windowSeconds,
  };
  const resetAt = windowEndsAt(next);
  return {
    next,
    decision: {
      allowed: true,
      count: next.count,
      remaining: rule.limit - next.count,
      resetAt,
    },
    scheduleAlarmAt: resetAt,
  };
}

export function applyHit(
  state: WindowState | undefined,
  now: number,
  rule: CounterRule,
): HitOutcome {
  assertValidInput(now, rule);
  if (state === undefined || now >= windowEndsAt(state)) {
    return startWindow(now, rule);
  }
  const resetAt = windowEndsAt(state);
  if (state.count >= rule.limit) {
    return {
      next: undefined,
      decision: { allowed: false, count: state.count, remaining: 0, resetAt },
      scheduleAlarmAt: undefined,
    };
  }
  const next: WindowState = { ...state, count: state.count + 1 };
  return {
    next,
    decision: {
      allowed: true,
      count: next.count,
      remaining: rule.limit - next.count,
      resetAt,
    },
    scheduleAlarmAt: undefined,
  };
}
