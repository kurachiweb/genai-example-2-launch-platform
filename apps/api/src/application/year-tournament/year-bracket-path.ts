const YEAR_BRACKET_PATH_PREFIX = '/tournaments/year/';

export function yearBracketPathOf(year: number): string {
  return `${YEAR_BRACKET_PATH_PREFIX}${String(year)}`;
}
