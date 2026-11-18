const DATE_PART_LENGTH = 2;

const padDatePart = (value: number): string =>
  String(value).padStart(DATE_PART_LENGTH, '0');

// カレンダーの日は閲覧者のローカルの0:00で表すため、業務日付を同じ暦日のローカルの日にして、閲覧者のタイムゾーンで日をずらさない
export const calendarDayOf = (businessDate: string): Date => {
  const utcMidnight = new Date(`${businessDate}T00:00:00.000Z`);
  return new Date(
    utcMidnight.getUTCFullYear(),
    utcMidnight.getUTCMonth(),
    utcMidnight.getUTCDate(),
  );
};

export const businessDateOfCalendarDay = (day: Date): string =>
  `${String(day.getFullYear())}-${padDatePart(day.getMonth() + 1)}-${padDatePart(day.getDate())}`;
