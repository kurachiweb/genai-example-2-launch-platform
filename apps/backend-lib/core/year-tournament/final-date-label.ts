import { type BusinessDate, businessWeekdayOf } from '../time/business-time.ts';

// ISO曜日(月1〜日7)の順
const WEEKDAY_LABELS = Object.freeze([
  '月',
  '火',
  '水',
  '木',
  '金',
  '土',
  '日',
]);

// 決勝実施日の表記。メールや保存した購入にも載るため、閲覧の年に依らず年と曜日を付ける
export function formatFinalDateLabel(date: BusinessDate): string {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = WEEKDAY_LABELS[businessWeekdayOf(date) - 1] ?? '';
  return `${String(year)}年${String(month)}月${String(day)}日(${weekday})`;
}
