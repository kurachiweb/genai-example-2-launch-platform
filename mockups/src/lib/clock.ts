// 基準時刻(UTC-08:00)の壁時計で日時を組み立てるヘルパー。Dateの内部値は常にUTC
const BASE_OFFSET_HOURS = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

export function at(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): Date {
  return new Date(
    Date.UTC(year, month - 1, day, hour + BASE_OFFSET_HOURS, minute),
  );
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

// 基準時刻での日付の0:00
export function startOfDay(date: Date): Date {
  const shifted = new Date(date.getTime() - BASE_OFFSET_HOURS * 3600 * 1000);
  return at(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

export function atTime(day: Date, hour: number, minute = 0): Date {
  return addMinutes(startOfDay(day), hour * 60 + minute);
}

// 基準時刻での週の月曜日0:00(週は月曜日始まり)
export function mondayOf(date: Date): Date {
  const day = startOfDay(date);
  const weekday = new Date(
    day.getTime() - BASE_OFFSET_HOURS * 3600 * 1000,
  ).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

// 基準時刻での日付をISO 8601の日付文字列にする(<time datetime>用)
export function isoDate(date: Date): string {
  const shifted = new Date(date.getTime() - BASE_OFFSET_HOURS * 3600 * 1000);
  return shifted.toISOString().slice(0, 10);
}

export const MATCH_END_HOUR = 23;
export const MATCH_END_MINUTE = 40;
// UIに表示する決済期限は決済セッションの作成期限(23:00)
export const PAYMENT_DEADLINE_HOUR = 23;

export function matchEndOf(day: Date): Date {
  return atTime(day, MATCH_END_HOUR, MATCH_END_MINUTE);
}

// ローンチ日を含む週の翌週月曜日(FR-TOURW-002)
export function weekPaymentDeadline(launchDate: Date): Date {
  return atTime(addDays(mondayOf(launchDate), 7), PAYMENT_DEADLINE_HOUR);
}

// Weekトーナメントは組み合わせ決定翌日の火曜日から1日1ラウンド。参加数9〜16の4ラウンド(1回戦〜決勝)を想定する
export function weekRoundDate(launchDate: Date, roundIndex: number): Date {
  return addDays(mondayOf(launchDate), 8 + roundIndex);
}

// 管理者が設定したYearトーナメント決勝日(日曜日、FR-ADMCF-001)の仮データ
const YEAR_FINAL_DATES = [at(2025, 5, 25), at(2026, 5, 24), at(2027, 5, 30)];
const YEAR_DEADLINE_DAYS_BEFORE_FINAL = 6;

export function yearPaymentDeadlineOf(finalDate: Date): Date {
  return atTime(
    addDays(finalDate, -YEAR_DEADLINE_DAYS_BEFORE_FINAL),
    PAYMENT_DEADLINE_HOUR,
  );
}

// Week優勝日時の後に決済期限を迎える最初のYearトーナメント決勝日(FR-TOURY-001)
export function yearFinalAfter(weekFinalDate: Date): Date {
  const found = YEAR_FINAL_DATES.find(
    (final) => yearPaymentDeadlineOf(final).getTime() > weekFinalDate.getTime(),
  );
  return found ?? YEAR_FINAL_DATES[YEAR_FINAL_DATES.length - 1];
}

// 参加数9〜16なら1回戦は決勝日の3日前(FR-TOURY-007)
export function yearRoundDate(finalDate: Date, roundIndex: number): Date {
  return addDays(finalDate, roundIndex - 3);
}

// ISO 8601の週番号(その週の木曜日が年初から何週目か)
function isoWeekOf(monday: Date): { year: number; week: number } {
  const [year, month, day] = isoDate(addDays(monday, 3)).split('-').map(Number);
  const ordinal =
    (Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / DAY_MS;
  return { year, week: Math.floor(ordinal / 7) + 1 };
}

// 表記規則の「2026年第37週(9/7〜9/13)」
export function weekLabelOf(date: Date): string {
  const monday = mondayOf(date);
  const { year, week } = isoWeekOf(monday);
  const short = (day: Date) => {
    const [, month, dayOfMonth] = isoDate(day).split('-').map(Number);
    return `${month}/${dayOfMonth}`;
  };
  return `${year}年第${week}週(${short(monday)}〜${short(addDays(monday, 6))})`;
}
