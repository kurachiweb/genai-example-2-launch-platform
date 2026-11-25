import { inject, injectable } from 'inversify';

import {
  formatWeekPeriodLabel,
  isoWeekKey,
} from '../../../common-lib/tournament/week-period.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { WEEK_TOURNAMENT_TYPES } from '../../../lib/core/week-tournament/identifiers.ts';
import type {
  WeekChampion,
  WeekChampionDirectory,
} from '../../../lib/core/week-tournament/ports.ts';
import type {
  TrophyRecord,
  TrophySource,
} from '../tournament/trophy-source.ts';
import { weekBracketPathOf } from './week-bracket-path.ts';

const trophyOf = ({ weekStart, awardedAt }: WeekChampion): TrophyRecord => {
  const period = isoWeekKey(weekStart);
  return {
    kind: 'week',
    period,
    periodLabel: formatWeekPeriodLabel(weekStart),
    awardedAt,
    bracketPath: weekBracketPathOf(weekStart),
  };
};

@injectable()
export class WeekTrophySource implements TrophySource {
  constructor(
    @inject(WEEK_TOURNAMENT_TYPES.WeekChampionDirectory)
    private readonly champions: WeekChampionDirectory,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  // Weekの受賞は1週に1件のため、全期間を1回で読んでプロダクトで絞る
  async listTrophies(productId: string): Promise<readonly TrophyRecord[]> {
    const champions = await this.champions.listChampions({
      awardedFrom: null,
      awardedBefore: this.clock.now(),
    });
    return champions
      .filter((champion) => champion.productId === productId)
      .map(trophyOf);
  }
}
