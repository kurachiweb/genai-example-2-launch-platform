import { and, asc, eq, inArray } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import { chunk, IDS_PER_STATEMENT } from '../../core/d1/statement-chunks.ts';
import { isoWeekKey } from '../../../common-lib/tournament/week-period.ts';
import type { Database } from '../../../db/client.ts';
import { weekTournamentEntries } from '../../../db/schema/tournament/week-tournament-entries.ts';
import { weekTournaments } from '../../../db/schema/tournament/week-tournaments.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type {
  WeekAward,
  WeekAwardExport,
} from '../../core/week-tournament/ports.ts';

@injectable()
export class D1WeekAwardExport implements WeekAwardExport {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async listForLaunches(
    launchIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly WeekAward[]>> {
    const pages = await Promise.all(
      chunk([...new Set(launchIds)], IDS_PER_STATEMENT).map((page) =>
        this.db
          .select({
            launchId: weekTournamentEntries.launchId,
            weekStart: weekTournaments.weekStart,
          })
          .from(weekTournaments)
          .innerJoin(
            weekTournamentEntries,
            eq(weekTournamentEntries.id, weekTournaments.championEntryId),
          )
          .where(
            and(
              eq(weekTournaments.outcome, 'awarded'),
              inArray(weekTournamentEntries.launchId, page),
            ),
          )
          .orderBy(asc(weekTournaments.weekStart)),
      ),
    );
    const byLaunch = new Map<string, WeekAward[]>();
    for (const { launchId, weekStart } of pages.flat()) {
      if (launchId !== null) {
        byLaunch.set(launchId, [
          ...(byLaunch.get(launchId) ?? []),
          { kind: 'product_of_the_week', period: isoWeekKey(weekStart) },
        ]);
      }
    }
    return byLaunch;
  }
}
