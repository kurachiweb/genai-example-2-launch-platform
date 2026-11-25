const COUNT_FORMAT = new Intl.NumberFormat('ja-JP');

export const upvoteHistoryDayCountLabel = (count: number): string =>
  `${COUNT_FORMAT.format(count)}件`;
