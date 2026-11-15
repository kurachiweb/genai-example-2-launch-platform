import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { matchEntries } from '../../../db/schema/match/match-entries.ts';
import { qualifierPairings } from '../../../db/schema/match/qualifier-pairings.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { BusinessDate } from '../../../lib/core/time/business-time.ts';
import type {
  PairingCounts,
  PairingDayState,
  PairingStore,
} from '../../application/match/ports.ts';

@injectable()
export class D1PairingStore implements PairingStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async beginDay(date: BusinessDate, at: Date): Promise<PairingDayState> {
    const [, rows] = await this.db.batch([
      this.db
        .insert(qualifierPairings)
        .values({ matchDate: date, createdAt: at, updatedAt: at })
        .onConflictDoNothing({ target: qualifierPairings.matchDate }),
      this.db
        .select({ status: qualifierPairings.status })
        .from(qualifierPairings)
        .where(eq(qualifierPairings.matchDate, date)),
    ]);
    return rows[0]?.status === 'completed' ? 'already-completed' : 'begun';
  }

  async completeDay(
    date: BusinessDate,
    counts: PairingCounts,
    at: Date,
  ): Promise<void> {
    await this.db
      .insert(qualifierPairings)
      .values({
        matchDate: date,
        status: 'completed',
        launchCount: counts.launches,
        matchCount: counts.matches,
        completedAt: at,
        createdAt: at,
        updatedAt: at,
      })
      .onConflictDoUpdate({
        target: qualifierPairings.matchDate,
        set: {
          status: 'completed',
          launchCount: sql`COALESCE(${qualifierPairings.launchCount}, 0) + ${counts.launches}`,
          matchCount: sql`COALESCE(${qualifierPairings.matchCount}, 0) + ${counts.matches}`,
          completedAt: sql`COALESCE(${qualifierPairings.completedAt}, ${at.getTime()})`,
          updatedAt: at,
        },
      });
  }

  async isDayCompleted(date: BusinessDate): Promise<boolean> {
    const rows = await this.db
      .select({ id: qualifierPairings.id })
      .from(qualifierPairings)
      .where(
        and(
          eq(qualifierPairings.matchDate, date),
          eq(qualifierPairings.status, 'completed'),
        ),
      );
    return rows.length > 0;
  }

  async pairedLaunchIds(date: BusinessDate): Promise<ReadonlySet<string>> {
    const rows = await this.db
      .select({ launchId: matchEntries.launchId })
      .from(matchEntries)
      .where(
        and(
          eq(matchEntries.matchKind, 'qualifier'),
          eq(matchEntries.matchDate, date),
          isNotNull(matchEntries.launchId),
        ),
      );
    return new Set(
      rows.flatMap(({ launchId }) => (launchId === null ? [] : [launchId])),
    );
  }
}
