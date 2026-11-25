import { isoWeekKey } from '../../../common-lib/tournament/week-period.ts';

const WEEK_BRACKET_PATH_PREFIX = '/tournaments/week/';

export function weekBracketPathOf(weekStart: string): string {
  return `${WEEK_BRACKET_PATH_PREFIX}${isoWeekKey(weekStart)}`;
}
