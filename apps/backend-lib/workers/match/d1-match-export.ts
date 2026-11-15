import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { matchEntries } from '../../../db/schema/match/match-entries.ts';
import { matchUpvotes } from '../../../db/schema/match/match-upvotes.ts';
import { matches } from '../../../db/schema/match/matches.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type {
  MatchExport,
  MatchExportRecord,
  UpvoteExport,
  UpvoteExportRecord,
} from '../../core/match/ports.ts';
import { parseBusinessDate } from '../../core/time/business-time.ts';

// D1のバインド変数の上限(100)から、IDの一覧以外に使う変数の分を残す
const IDS_PER_STATEMENT = 90;

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

@injectable()
export class D1MatchExport implements MatchExport {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async listForLaunches(
    launchIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly MatchExportRecord[]>> {
    const opponent = alias(matchEntries, 'opponent');
    const pages = await Promise.all(
      chunk([...new Set(launchIds)], IDS_PER_STATEMENT).map((page) =>
        this.db
          .select({
            matchId: matches.id,
            launchId: matchEntries.launchId,
            kind: matches.kind,
            round: matches.round,
            matchDate: matches.matchDate,
            upvoteCount: matchEntries.upvoteCount,
            // 不戦勝は相手の側の行が無いため0にする
            opponentUpvoteCount:
              sql<number>`coalesce(${opponent.upvoteCount}, 0)`.mapWith(Number),
            lastUpvotedAt: matchEntries.lastUpvotedAt,
            result: matchEntries.result,
          })
          .from(matchEntries)
          .innerJoin(matches, eq(matches.id, matchEntries.matchId))
          .leftJoin(
            opponent,
            and(
              eq(opponent.matchId, matchEntries.matchId),
              ne(opponent.slot, matchEntries.slot),
            ),
          )
          .where(inArray(matchEntries.launchId, page))
          .orderBy(asc(matches.matchDate), asc(matches.id)),
      ),
    );
    const byLaunch = new Map<string, MatchExportRecord[]>();
    for (const { launchId, matchDate, ...row } of pages.flat()) {
      if (launchId !== null) {
        byLaunch.set(launchId, [
          ...(byLaunch.get(launchId) ?? []),
          { ...row, launchId, date: parseBusinessDate(matchDate) },
        ]);
      }
    }
    return byLaunch;
  }
}

@injectable()
export class D1UpvoteExport implements UpvoteExport {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async listByUser(userId: string): Promise<readonly UpvoteExportRecord[]> {
    const rows = await this.db
      .select({
        matchId: matchUpvotes.matchId,
        matchKind: matchEntries.matchKind,
        matchDate: matchUpvotes.matchDate,
        productId: matchEntries.productId,
        upvotedAt: matchUpvotes.upvotedAt,
      })
      .from(matchUpvotes)
      .innerJoin(matchEntries, eq(matchEntries.id, matchUpvotes.entryId))
      .where(
        and(eq(matchUpvotes.userId, userId), isNull(matchUpvotes.deletedAt)),
      )
      .orderBy(asc(matchUpvotes.upvotedAt), asc(matchUpvotes.id));
    return rows.map((row) => ({
      ...row,
      matchDate: parseBusinessDate(row.matchDate),
    }));
  }
}
