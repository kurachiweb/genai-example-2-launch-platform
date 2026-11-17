import { inject, injectable } from 'inversify';

import { TOURNAMENT_PLATFORM_TYPES } from '../../../lib/core/tournament/identifiers.ts';
import type { BracketStore } from '../../../lib/core/tournament/ports.ts';
import { WEEK_TOURNAMENT_TYPES } from '../../../lib/core/week-tournament/identifiers.ts';
import type { WeekTournamentStore } from '../../../lib/core/week-tournament/ports.ts';
import type {
  DecisionSubject,
  ProductLockEntry,
  ProductLockSource,
} from '../product/decision-sources.ts';
import {
  isContending,
  readWeekLaunchStandings,
  wonLaunchesOf,
} from './week-launch-standings.ts';

export const WEEK_PRODUCT_LOCK_MESSAGE =
  'Weekトーナメントに勝ち残っているため、ローンチ日・カテゴリの変更と削除はできません。';

@injectable()
export class WeekProductLockSource implements ProductLockSource {
  constructor(
    @inject(WEEK_TOURNAMENT_TYPES.WeekTournamentStore)
    private readonly store: WeekTournamentStore,
    @inject(TOURNAMENT_PLATFORM_TYPES.BracketStore)
    private readonly brackets: BracketStore,
  ) {}

  async findLocks(input: {
    readonly subjects: readonly DecisionSubject[];
    readonly at: Date;
  }): Promise<readonly ProductLockEntry[]> {
    const standings = await readWeekLaunchStandings(
      this.store,
      this.brackets,
      wonLaunchesOf(input.subjects),
    );
    return standings.filter(isContending).map(({ launch }) => ({
      productId: launch.productId,
      code: 'tournament-week.bracket-lock',
      message: WEEK_PRODUCT_LOCK_MESSAGE,
    }));
  }
}
