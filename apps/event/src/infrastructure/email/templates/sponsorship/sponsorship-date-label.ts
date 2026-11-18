import { parseCalendarDate } from '../../../../../common-lib/time/business-date-arithmetic.ts';

// 業務日付はUTCの時点ではないため、暦日のまま表記し、どの時刻の日付かは呼び出し側が添える
export function formatSponsorshipDate(date: string): string {
  const { year, month, day } = parseCalendarDate(date);
  return `${String(year)}年${String(month)}月${String(day)}日`;
}

// 終了日は開始日と同じ年なら年を省き、年をまたぐときだけ年を付ける
export function formatSponsorshipEndDate(
  startsOn: string,
  endsOn: string,
): string {
  const start = parseCalendarDate(startsOn);
  const end = parseCalendarDate(endsOn);
  return start.year === end.year
    ? `${String(end.month)}月${String(end.day)}日`
    : formatSponsorshipDate(endsOn);
}
