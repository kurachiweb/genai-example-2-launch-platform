const BUSINESS_DATE_PATTERN = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u;

// 文言規則の日付の示し方: 今年なら月日だけ、今年でなければ年を付ける。業務日付の暦日のまま示し、閲覧者のタイムゾーンで日をずらさない
export const formatBusinessDateLabel = (
  date: string,
  currentYear: number,
): string => {
  const groups = BUSINESS_DATE_PATTERN.exec(date)?.groups;
  if (groups === undefined) {
    throw new RangeError(`業務日付の形でない値です: ${date}`);
  }
  const year = Number(groups.year);
  const monthDay = `${String(Number(groups.month))}月${String(Number(groups.day))}日`;
  return year === currentYear ? monthDay : `${String(year)}年${monthDay}`;
};
