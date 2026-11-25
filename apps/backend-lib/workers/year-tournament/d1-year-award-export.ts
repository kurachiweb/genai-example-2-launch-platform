import { and, asc, eq, inArray } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import { chunk, IDS_PER_STATEMENT } from '../../core/d1/statement-chunks.ts';
import type { Database } from '../../../db/client.ts';
import { yearTournamentEntries } from '../../../db/schema/tournament/year-tournament-entries.ts';
import { yearTournaments } from '../../../db/schema/tournament/year-tournaments.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type {
  YearAward,
  YearAwardExport,
} from '../../core/year-tournament/ports.ts';

@injectable()
export class D1YearAwardExport implements YearAwardExport {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async listForLaunches(
    launchIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly YearAward[]>> {
    const pages = await Promise.all(
      chunk([...new Set(launchIds)], IDS_PER_STATEMENT).map((page) =>
        this.db
          .select({
            launchId: yearTournamentEntries.launchId,
            year: yearTournaments.year,
          })
          .from(yearTournaments)
          .innerJoin(
            yearTournamentEntries,
            eq(yearTournamentEntries.id, yearTournaments.championEntryId),
          )
          .where(
            and(
              eq(yearTournaments.outcome, 'awarded'),
              inArray(yearTournamentEntries.launchId, page),
            ),
          )
          .orderBy(asc(yearTournaments.year)),
      ),
    );
    const byLaunch = new Map<string, YearAward[]>();
    for (const { launchId, year } of pages.flat()) {
      if (launchId !== null) {
        byLaunch.set(launchId, [
          ...(byLaunch.get(launchId) ?? []),
          { kind: 'product_of_the_year', period: String(year) },
        ]);
      }
    }
    return byLaunch;
  }
}
