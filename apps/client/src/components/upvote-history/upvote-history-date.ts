const BUSINESS_DATE_PATTERN = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u;

const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'] as const;

const COUNT_FORMAT = new Intl.NumberFormat('ja-JP');

// マッチ実施日は業務日付の暦日のまま示し、利用者のタイムゾーンで日をずらさない。曜日も暦日から求める
export const formatUpvoteHistoryDate = (date: string): string => {
  const groups = BUSINESS_DATE_PATTERN.exec(date)?.groups;
  if (groups === undefined) {
    throw new RangeError(`業務日付の形でない値です: ${date}`);
  }
  const year = Number(groups.year);
  const month = Number(groups.month);
  const day = Number(groups.day);
  const weekday =
    WEEKDAY_NAMES[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${String(year)}年${String(month)}月${String(day)}日(${weekday ?? ''})`;
};

export const upvoteHistoryDayCountLabel = (count: number): string =>
  `${COUNT_FORMAT.format(count)}件`;
