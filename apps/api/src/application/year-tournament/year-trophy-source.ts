import { inject, injectable } from 'inversify';

import { YEAR_TOURNAMENT_TYPES } from '../../../lib/core/year-tournament/identifiers.ts';
import type {
  YearProductAward,
  YearTournamentStore,
} from '../../../lib/core/year-tournament/ports.ts';
import type {
  TrophyRecord,
  TrophySource,
} from '../tournament/trophy-source.ts';
import { yearBracketPathOf } from './year-bracket-path.ts';

const trophyOf = ({ year, awardedAt }: YearProductAward): TrophyRecord => {
  const period = String(year);
  return {
    kind: 'year',
    period,
    periodLabel: `${period}年`,
    awardedAt,
    bracketPath: yearBracketPathOf(year),
  };
};

@injectable()
export class YearTrophySource implements TrophySource {
  constructor(
    @inject(YEAR_TOURNAMENT_TYPES.YearTournamentStore)
    private readonly tournaments: Pick<
      YearTournamentStore,
      'listAwardsByProducts'
    >,
  ) {}

  async listTrophies(productId: string): Promise<readonly TrophyRecord[]> {
    const awards = await this.tournaments.listAwardsByProducts([productId]);
    return awards.map(trophyOf);
  }
}
