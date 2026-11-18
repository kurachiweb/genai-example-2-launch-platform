export interface FinalDateChoiceInput {
  readonly choices: readonly string[];
  readonly current: string;
  readonly preferred: string;
}

const BUSINESS_DATE_PATTERN = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u;

const MILLISECONDS_PER_DAY = 86_400_000;

const dayNumberOf = (date: string): number => {
  const groups = BUSINESS_DATE_PATTERN.exec(date)?.groups;
  if (groups === undefined) {
    throw new RangeError(`業務日付の形でない値です: ${date}`);
  }
  return (
    Date.UTC(
      Number(groups.year),
      Number(groups.month) - 1,
      Number(groups.day),
    ) / MILLISECONDS_PER_DAY
  );
};

// 繰り返し実行しても版の競合や行の偏りを生まないよう、現在と違う候補のうち既定の日に最も近い日を選ぶ。既定の日と現在の日を行き来する
export function pickFinalDateChoice({
  choices,
  current,
  preferred,
}: FinalDateChoiceInput): string {
  const preferredDay = dayNumberOf(preferred);
  const ranked = choices
    .map((date) => ({
      date,
      distance: Math.abs(dayNumberOf(date) - preferredDay),
    }))
    .filter(({ date }) => date !== current)
    .toSorted(
      (left, right) =>
        left.distance - right.distance || left.date.localeCompare(right.date),
    );
  const [nearest] = ranked;
  if (nearest === undefined) {
    throw new RangeError(
      `現在の決勝実施日(${current})と違う候補がありません: ${choices.join(', ')}`,
    );
  }
  return nearest.date;
}
