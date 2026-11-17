import { inject, injectable } from 'inversify';

import { TOURNAMENT_PLATFORM_TYPES } from '../../../lib/core/tournament/identifiers.ts';
import type { BracketStore } from '../../../lib/core/tournament/ports.ts';
import { YEAR_TOURNAMENT_TYPES } from '../../../lib/core/year-tournament/identifiers.ts';
import type {
  YearCalendar,
  YearEntryStore,
} from '../../../lib/core/year-tournament/ports.ts';
import type {
  DecisionSubject,
  ProductLockEntry,
  ProductLockSource,
} from '../product/decision-sources.ts';
import {
  isContending,
  readYearLaunchStandings,
  wonLaunchesOf,
} from './year-launch-standings.ts';

export const YEAR_PRODUCT_LOCK_MESSAGE =
  'Yearトーナメントに勝ち残っているため、ローンチ日・カテゴリの変更と削除はできません。';

@injectable()
export class YearProductLockSource implements ProductLockSource {
  constructor(
    @inject(YEAR_TOURNAMENT_TYPES.YearEntryStore)
    private readonly entries: YearEntryStore,
    @inject(TOURNAMENT_PLATFORM_TYPES.BracketStore)
    private readonly brackets: BracketStore,
    @inject(YEAR_TOURNAMENT_TYPES.YearCalendar)
    private readonly calendar: YearCalendar,
  ) {}

  async findLocks(input: {
    readonly subjects: readonly DecisionSubject[];
    readonly at: Date;
  }): Promise<readonly ProductLockEntry[]> {
    const standings = await readYearLaunchStandings(
      {
        entries: this.entries,
        brackets: this.brackets,
        calendar: this.calendar,
      },
      wonLaunchesOf(input.subjects),
      input.at,
    );
    return standings.filter(isContending).map(({ launch }) => ({
      productId: launch.productId,
      code: 'tournament-year.bracket-lock',
      message: YEAR_PRODUCT_LOCK_MESSAGE,
    }));
  }
}
