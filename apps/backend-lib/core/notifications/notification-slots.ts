import { isUppercaseUlid } from '../ids/uppercase-ulid.ts';
import { MATCH_SCHEDULE } from '../match/match-model.ts';
import { PAIRING_TIME } from '../product/launch-status.ts';
import {
  type BusinessDate,
  type BusinessTimeOfDay,
  fromBusinessDateTime,
  parseBusinessDate,
  toBusinessDateTime,
} from '../time/business-time.ts';

export type NotificationSlotKind = 'evening' | 'morning' | 'award';

export interface NotificationSlot {
  readonly key: string;
  readonly kind: NotificationSlotKind;
  readonly dueAt: Date;
  readonly settleUntil: Date;
}

export type ParsedSlotKey =
  | {
      readonly key: string;
      readonly kind: 'evening' | 'morning';
      readonly date: BusinessDate;
    }
  | {
      readonly key: string;
      readonly kind: 'award';
      readonly eventId: string;
    };

export const EVENING_SLOT_TIME: BusinessTimeOfDay = PAIRING_TIME;

export const MORNING_SLOT_TIME: BusinessTimeOfDay = MATCH_SCHEDULE.kickoff;

export const EVENING_DISPATCH_DEADLINE_SECONDS = 600;

export const MORNING_KICKOFF_WAIT_SECONDS = 300;

const MILLISECONDS_PER_SECOND = 1000;
const MILLISECONDS_PER_DAY = 86_400_000;
const START_OF_DAY: BusinessTimeOfDay = Object.freeze({ hour: 0, minute: 0 });
const DATED_SLOT_KEY_PATTERN =
  /^(?<kind>evening|morning):(?<date>\d{4}-\d{2}-\d{2})$/u;
const AWARD_SLOT_KEY_PREFIX = 'award:';

export function eveningSlot(date: BusinessDate): NotificationSlot {
  const dueAt = fromBusinessDateTime(date, EVENING_SLOT_TIME);
  return {
    key: `evening:${date}`,
    kind: 'evening',
    dueAt,
    settleUntil: new Date(
      dueAt.getTime() +
        EVENING_DISPATCH_DEADLINE_SECONDS * MILLISECONDS_PER_SECOND,
    ),
  };
}

export function morningSlot(date: BusinessDate): NotificationSlot {
  const dueAt = fromBusinessDateTime(date, MORNING_SLOT_TIME);
  return { key: `morning:${date}`, kind: 'morning', dueAt, settleUntil: dueAt };
}

export function awardSlot(eventId: string, at: Date): NotificationSlot {
  if (!isUppercaseUlid(eventId)) {
    throw new RangeError(
      `通知イベントのIDはULIDで指定してください: ${eventId}`,
    );
  }
  if (Number.isNaN(at.getTime())) {
    throw new RangeError('不正な時点では受賞の枠を作れません');
  }
  return {
    key: `${AWARD_SLOT_KEY_PREFIX}${eventId}`,
    kind: 'award',
    dueAt: at,
    settleUntil: at,
  };
}

// 業務時刻は固定のオフセットで夏時間が無いため、0:00の24時間前の時点の業務日付が前日になる
function previousBusinessDate(date: BusinessDate): BusinessDate {
  const startOfDay = fromBusinessDateTime(date, START_OF_DAY);
  return toBusinessDateTime(
    new Date(startOfDay.getTime() - MILLISECONDS_PER_DAY),
  ).date;
}

export function previewSlotFor(matchDate: BusinessDate): NotificationSlot {
  return eveningSlot(previousBusinessDate(matchDate));
}

export function resultSlotFor(matchDate: BusinessDate): NotificationSlot {
  return eveningSlot(matchDate);
}

function parseDate(value: string): BusinessDate | undefined {
  try {
    return parseBusinessDate(value);
  } catch {
    return undefined;
  }
}

export function parseSlotKey(key: string): ParsedSlotKey | undefined {
  if (key.startsWith(AWARD_SLOT_KEY_PREFIX)) {
    const eventId = key.slice(AWARD_SLOT_KEY_PREFIX.length);
    return isUppercaseUlid(eventId)
      ? { key, kind: 'award', eventId }
      : undefined;
  }
  const groups = DATED_SLOT_KEY_PATTERN.exec(key)?.groups;
  if (groups?.kind === undefined || groups.date === undefined) {
    return undefined;
  }
  const date = parseDate(groups.date);
  if (date === undefined) {
    return undefined;
  }
  return { key, kind: groups.kind as 'evening' | 'morning', date };
}
