import {
  addBusinessDays,
  type BusinessDate,
  type BusinessTimeOfDay,
  fromBusinessDateTime,
  toBusinessDateTime,
} from '../time/business-time.ts';

export type LaunchStatus =
  'scheduled' | 'paired' | 'in_progress' | 'finished' | 'canceled';

export const QUALIFIER_OUTCOMES = Object.freeze(['won', 'lost'] as const);

export type QualifierOutcome = (typeof QUALIFIER_OUTCOMES)[number];

export interface LaunchFacts {
  readonly launchDate: BusinessDate;
  readonly outcome: QualifierOutcome | null;
  readonly cancelledAt: Date | null;
}

export const PAIRING_TIME: BusinessTimeOfDay = Object.freeze({
  hour: 23,
  minute: 45,
});

export const LAUNCH_SELECTION_CUTOFF: BusinessTimeOfDay = Object.freeze({
  hour: 23,
  minute: 40,
});

const START_OF_DAY: BusinessTimeOfDay = Object.freeze({ hour: 0, minute: 0 });

function isAtOrAfter(
  time: BusinessTimeOfDay,
  boundary: BusinessTimeOfDay,
): boolean {
  return (
    time.hour > boundary.hour ||
    (time.hour === boundary.hour && time.minute >= boundary.minute)
  );
}

export function kickoffAt(launchDate: BusinessDate): Date {
  return fromBusinessDateTime(launchDate, START_OF_DAY);
}

export function qualifierLockThresholdDate(now: Date): BusinessDate {
  const current = toBusinessDateTime(now);
  if (!isAtOrAfter(current, PAIRING_TIME)) {
    return current.date;
  }
  return addBusinessDays(current.date, 1);
}

// 業務日付はYYYY-MM-DDの固定長のため、文字列の比較が日付の前後と一致する
export function deriveLaunchStatus(
  launch: LaunchFacts,
  now: Date,
): LaunchStatus {
  if (launch.cancelledAt !== null) {
    return 'canceled';
  }
  if (launch.outcome !== null) {
    return 'finished';
  }
  if (launch.launchDate <= toBusinessDateTime(now).date) {
    return 'in_progress';
  }
  if (launch.launchDate <= qualifierLockThresholdDate(now)) {
    return 'paired';
  }
  return 'scheduled';
}
