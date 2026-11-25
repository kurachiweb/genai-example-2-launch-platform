const YEAR_PATTERN = /^\d{4}$/u;
const MIN_YEAR = 1;

export function parseTournamentYear(value: string): number | undefined {
  if (!YEAR_PATTERN.test(value)) {
    return undefined;
  }
  const year = Number(value);
  return year < MIN_YEAR ? undefined : year;
}
