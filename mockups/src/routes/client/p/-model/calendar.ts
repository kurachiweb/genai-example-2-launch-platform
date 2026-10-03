// ローンチ日と期間は基準時刻(UTC-08:00)の暦日であり、閲覧者のタイムゾーンへ変換しない。暦日は`YYYY-MM-DD`文字列で扱う
const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// モックの「今日」。当日のマッチはまだ終わっていないため、掲載される最新のローンチ日は昨日になる
export const TODAY = '2026-09-24';
export const YESTERDAY = addDays(TODAY, -1);
// 最初のローンチ日(仮データの日付の下限)
export const SERVICE_START = '2025-01-06';

function toDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// 実在する日付の`YYYY-MM-DD`のみ受け付ける(2026-02-30などは不正)
export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  return toIso(toDate(value)) === value;
}

export function addDays(iso: string, days: number): string {
  return toIso(new Date(toDate(iso).getTime() + days * DAY_MS));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / DAY_MS);
}

// 週は月曜日始まり
export function mondayOf(iso: string): string {
  const weekday = toDate(iso).getUTCDay();
  return addDays(iso, -((weekday + 6) % 7));
}

export function monthRangeOf(iso: string): [string, string] {
  const date = toDate(iso);
  const first = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1),
  );
  const last = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  );
  return [toIso(first), toIso(last)];
}

export function yearRangeOf(iso: string): [string, string] {
  const year = iso.slice(0, 4);
  return [`${year}-01-01`, `${year}-12-31`];
}

export function yearOf(iso: string): number {
  return Number(iso.slice(0, 4));
}

// 表示形式の切り替えに使うUTC 0時のDate(タイムゾーン変換しない暦日として整形する)
export function calendarDate(iso: string): Date {
  return toDate(iso);
}

// ISO 8601の週番号(その週の木曜日が年初から何週目か)
function isoWeekOf(iso: string): { year: number; week: number } {
  const thursday = addDays(mondayOf(iso), 3);
  const year = yearOf(thursday);
  const ordinal = daysBetween(`${year}-01-01`, thursday);
  return { year, week: Math.floor(ordinal / 7) + 1 };
}

// 表記規則の「2026年第37週(9/7〜9/13)」
export function weekLabelOf(iso: string): string {
  const monday = mondayOf(iso);
  const { year, week } = isoWeekOf(iso);
  const short = (value: string) => {
    const [, month, day] = value.split('-').map(Number);
    return `${month}/${day}`;
  };
  return `${year}年第${week}週(${short(monday)}〜${short(addDays(monday, 6))})`;
}
