import { and, asc, eq, inArray } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { yearTournamentEntries } from '../../../db/schema/tournament/year-tournament-entries.ts';
import { yearTournaments } from '../../../db/schema/tournament/year-tournaments.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type {
  YearAward,
  YearAwardExport,
} from '../../core/year-tournament/ports.ts';

// D1のバインド変数の上限(100)から、IDの一覧以外に使う変数の分を残す
const IDS_PER_STATEMENT = 90;

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

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
