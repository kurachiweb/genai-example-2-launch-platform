const BUSINESS_DATE_PATTERN = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u;

// Date#getUTCDayの順(日0〜土6)
const WEEKDAY_NAMES = Object.freeze(['日', '月', '火', '水', '木', '金', '土']);

interface BusinessDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

function partsOf(date: string): BusinessDateParts {
  const groups = BUSINESS_DATE_PATTERN.exec(date)?.groups;
  if (groups === undefined) {
    throw new RangeError(`業務日付の形でない値です: ${date}`);
  }
  return {
    year: Number(groups.year),
    month: Number(groups.month),
    day: Number(groups.day),
  };
}

// 文言規則の日付の示し方: 今年なら月日だけ、今年でなければ年を付ける。業務日付の暦日のまま示し、閲覧者のタイムゾーンで日をずらさない
export const formatBusinessDateLabel = (
  date: string,
  currentYear: number,
): string => {
  const { year, month, day } = partsOf(date);
  const monthDay = `${String(month)}月${String(day)}日`;
  return year === currentYear ? monthDay : `${String(year)}年${monthDay}`;
};

function weekdayOf({ year, month, day }: BusinessDateParts): string {
  const utcMidnight = new Date(0);
  // Date.UTCは0〜99年を1900年代に読み替えるため、年を直接設定する
  utcMidnight.setUTCFullYear(year, month - 1, day);
  return WEEKDAY_NAMES[utcMidnight.getUTCDay()] ?? '';
}

// メールや保存した記録にも載る日付は、閲覧の年によらず年と曜日を付ける。曜日も業務日付の暦日から求める
export const formatBusinessDateWithWeekdayLabel = (date: string): string => {
  const parts = partsOf(date);
  const { year, month, day } = parts;
  return `${String(year)}年${String(month)}月${String(day)}日(${weekdayOf(parts)})`;
};
