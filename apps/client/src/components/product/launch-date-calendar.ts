import type {
  LaunchDateUnavailableReasonView,
  LaunchDateWindowView,
} from '../../graphql/my-products.ts';

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

// 業務日付はYYYY-MM-DDの固定長のため、文字列の比較が日付の前後と一致する。選べない範囲に無い最も早い日より前の日(過去の日)は締め切りを過ぎた日、最も遅い日より後の日は選べる期間の外とする
export const unavailableReasonOn = (
  window: LaunchDateWindowView,
  businessDate: string,
): LaunchDateUnavailableReasonView | undefined => {
  const range = window.unavailable.find(
    ({ from, to }) => from <= businessDate && businessDate <= to,
  );
  if (range !== undefined) {
    return range.reason;
  }
  if (businessDate < window.earliest) {
    return 'pairing_deadline';
  }
  return businessDate > window.latest ? 'out_of_range' : undefined;
};
