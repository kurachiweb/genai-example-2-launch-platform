import { LAUNCH_DATE_HORIZON_DAYS } from '../../../common-lib/product/product-input-rules.ts';
import {
  LAUNCH_SELECTION_CUTOFF,
  type QualifierOutcome,
} from '../../../lib/core/product/launch-status.ts';
import {
  type BusinessDate,
  fromBusinessDateTime,
  toBusinessDateTime,
} from '../../../lib/core/time/business-time.ts';

export type LaunchDateUnavailableReason =
  'pairing_deadline' | 'relaunch_interval' | 'out_of_range';

export interface LaunchDateUnavailableRange {
  readonly from: BusinessDate;
  readonly to: BusinessDate;
  readonly reason: LaunchDateUnavailableReason;
}

export type RelaunchIntervalDays = 7 | 2;

export interface LaunchDateWindow {
  readonly earliest: BusinessDate;
  readonly latest: BusinessDate;
  readonly unavailable: readonly LaunchDateUnavailableRange[];
  readonly relaunchIntervalDays: RelaunchIntervalDays | null;
}

export interface LaunchBasis {
  readonly launchDate: BusinessDate;
  readonly outcome: QualifierOutcome;
}

export type LaunchDateCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: LaunchDateUnavailableReason;
      readonly earliest: BusinessDate;
      readonly latest: BusinessDate;
    };

const RELAUNCH_INTERVAL_DAYS = 7;
const ENTITLED_RELAUNCH_INTERVAL_DAYS = 2;
const MILLISECONDS_PER_DAY = 86_400_000;
const START_OF_DAY = Object.freeze({ hour: 0, minute: 0 });

// 業務時刻は固定のオフセットで夏時間が無いため、0:00に日数分のミリ秒を足した時点の業務日付が日数後の日になる
export function addBusinessDays(
  date: BusinessDate,
  days: number,
): BusinessDate {
  const midnight = fromBusinessDateTime(date, START_OF_DAY);
  return toBusinessDateTime(
    new Date(midnight.getTime() + days * MILLISECONDS_PER_DAY),
  ).date;
}

function isBeforeSelectionCutoff(now: Date): boolean {
  const { hour, minute } = toBusinessDateTime(now);
  return (
    hour < LAUNCH_SELECTION_CUTOFF.hour ||
    (hour === LAUNCH_SELECTION_CUTOFF.hour &&
      minute < LAUNCH_SELECTION_CUTOFF.minute)
  );
}

function relaunchIntervalOf(
  basis: LaunchBasis | null,
  entitled: boolean,
): RelaunchIntervalDays | null {
  if (basis?.outcome !== 'lost') {
    return null;
  }
  return entitled ? ENTITLED_RELAUNCH_INTERVAL_DAYS : RELAUNCH_INTERVAL_DAYS;
}

// 業務日付はYYYY-MM-DDの固定長のため、文字列の比較が日付の前後と一致する
export function computeLaunchDateWindow(input: {
  readonly now: Date;
  readonly basis: LaunchBasis | null;
  readonly entitled: boolean;
}): LaunchDateWindow {
  const today = toBusinessDateTime(input.now).date;
  const pairingEarliest = addBusinessDays(
    today,
    isBeforeSelectionCutoff(input.now) ? 1 : 2,
  );
  const latest = addBusinessDays(today, LAUNCH_DATE_HORIZON_DAYS);
  const interval = relaunchIntervalOf(input.basis, input.entitled);
  const intervalEarliest =
    input.basis !== null && interval !== null
      ? addBusinessDays(input.basis.launchDate, interval)
      : null;
  const intervalApplies =
    intervalEarliest !== null && intervalEarliest > pairingEarliest;
  const earliest = intervalApplies ? intervalEarliest : pairingEarliest;
  const outOfRange = addBusinessDays(latest, 1);
  return {
    earliest,
    latest,
    unavailable: [
      {
        from: today,
        to: addBusinessDays(pairingEarliest, -1),
        reason: 'pairing_deadline',
      },
      ...(intervalApplies
        ? [
            {
              from: pairingEarliest,
              to: addBusinessDays(earliest, -1),
              reason: 'relaunch_interval' as const,
            },
          ]
        : []),
      { from: outOfRange, to: outOfRange, reason: 'out_of_range' },
    ],
    relaunchIntervalDays: intervalApplies ? interval : null,
  };
}

function unavailableReasonOf(
  window: LaunchDateWindow,
  date: BusinessDate,
): LaunchDateUnavailableReason | null {
  if (date > window.latest) {
    return 'out_of_range';
  }
  if (date >= window.earliest) {
    return null;
  }
  const isInInterval = window.unavailable.some(
    ({ from, to, reason }) =>
      reason === 'relaunch_interval' && from <= date && date <= to,
  );
  // 今日より前の日もペアリングの締め切りを過ぎた日として扱う
  return isInInterval ? 'relaunch_interval' : 'pairing_deadline';
}

export function checkLaunchDate(
  window: LaunchDateWindow,
  date: BusinessDate,
): LaunchDateCheck {
  const reason = unavailableReasonOf(window, date);
  if (reason === null) {
    return { ok: true };
  }
  return {
    ok: false,
    reason,
    earliest: window.earliest,
    latest: window.latest,
  };
}
