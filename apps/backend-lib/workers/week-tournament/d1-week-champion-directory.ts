import { and, asc, eq, gte, isNotNull, lt } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { weekTournamentEntries } from '../../../db/schema/tournament/week-tournament-entries.ts';
import { weekTournaments } from '../../../db/schema/tournament/week-tournaments.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import { parseBusinessDate } from '../../core/time/business-time.ts';
import type {
  WeekChampion,
  WeekChampionDirectory,
} from '../../core/week-tournament/ports.ts';

@injectable()
export class D1WeekChampionDirectory implements WeekChampionDirectory {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async listChampions(input: {
    readonly awardedFrom: Date | null;
    readonly awardedBefore: Date;
  }): Promise<readonly WeekChampion[]> {
    const rows = await this.db
      .select({
        tournamentId: weekTournaments.id,
        weekStart: weekTournaments.weekStart,
        productId: weekTournamentEntries.productId,
        launchId: weekTournamentEntries.launchId,
        ownerUserId: weekTournamentEntries.ownerUserId,
        awardedAt: weekTournaments.awardedAt,
      })
      .from(weekTournaments)
      .innerJoin(
        weekTournamentEntries,
        eq(weekTournamentEntries.id, weekTournaments.championEntryId),
      )
      .where(
        and(
          eq(weekTournaments.outcome, 'awarded'),
          input.awardedFrom === null
            ? isNotNull(weekTournaments.awardedAt)
            : gte(weekTournaments.awardedAt, input.awardedFrom),
          lt(weekTournaments.awardedAt, input.awardedBefore),
          isNotNull(weekTournamentEntries.productId),
          isNotNull(weekTournamentEntries.launchId),
          isNotNull(weekTournamentEntries.ownerUserId),
        ),
      )
      .orderBy(asc(weekTournaments.awardedAt), asc(weekTournaments.weekStart));
    return rows.flatMap(
      ({ weekStart, productId, launchId, ownerUserId, awardedAt, ...row }) =>
        productId === null ||
        launchId === null ||
        ownerUserId === null ||
        awardedAt === null
          ? []
          : [
              {
                ...row,
                weekStart: parseBusinessDate(weekStart),
                productId,
                launchId,
                ownerUserId,
                awardedAt,
              },
            ],
    );
  }
}
