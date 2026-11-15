import { and, eq, inArray, isNull } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { matchUpvotes } from '../../../db/schema/match/match-upvotes.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { MatchBoardStore } from '../../application/match/ports.ts';

// D1のバインド変数の上限(100)から、IDの一覧以外に使う変数の分を残す
const IDS_PER_STATEMENT = 90;

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

@injectable()
export class D1MatchBoardStore implements MatchBoardStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async viewerUpvotes(
    matchIds: readonly string[],
    userId: string,
  ): Promise<ReadonlyMap<string, string>> {
    const pages = await Promise.all(
      chunk([...new Set(matchIds)], IDS_PER_STATEMENT).map((page) =>
        this.db
          .select({
            matchId: matchUpvotes.matchId,
            entryId: matchUpvotes.entryId,
          })
          .from(matchUpvotes)
          .where(
            and(
              eq(matchUpvotes.userId, userId),
              isNull(matchUpvotes.deletedAt),
              inArray(matchUpvotes.matchId, page),
            ),
          ),
      ),
    );
    return new Map(pages.flat().map((row) => [row.matchId, row.entryId]));
  }
}
