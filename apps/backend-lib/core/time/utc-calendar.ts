// UTCの暦でyears年前の同じ時刻。保持期間の期限に使い、同じ日が無い2月29日は月末へ寄せて期間に満たない記録を消さない
export function utcYearsBefore(time: Date, years: number): Date {
  const year = time.getUTCFullYear() - years;
  const month = time.getUTCMonth();
  const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(time.getUTCDate(), lastDayOfMonth),
      time.getUTCHours(),
      time.getUTCMinutes(),
      time.getUTCSeconds(),
      time.getUTCMilliseconds(),
    ),
  );
}
