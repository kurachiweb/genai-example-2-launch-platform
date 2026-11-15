import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';

import type { Database } from '../../../db/client.ts';
import { matchEntries } from '../../../db/schema/match/match-entries.ts';
import { matchUpvotes } from '../../../db/schema/match/match-upvotes.ts';
import { acceptingCondition } from './upvote-guards.ts';

function activeUpvotesOfEntry(): SQL | undefined {
  return and(
    eq(matchUpvotes.entryId, matchEntries.id),
    isNull(matchUpvotes.deletedAt),
  );
}

// 確定の決着の順(最終Upvote時間、同じなら記録の順)と同じ並びの先頭
function latestUpvote(
  column: typeof matchUpvotes.upvotedAt | typeof matchUpvotes.seq,
): SQL {
  return sql`(SELECT ${column} FROM ${matchUpvotes} WHERE ${activeUpvotesOfEntry()} ORDER BY ${desc(matchUpvotes.upvotedAt)}, ${desc(matchUpvotes.seq)} LIMIT 1)`;
}

// 側の集計値を有効なUpvoteから求め直す集合の更新。受け付け中のマッチの側だけを対象にし、確定・集計中のマッチの確定値を変えない
export function tallyRecomputeStatement(
  db: Database,
  target: SQL,
  now: Date,
): BatchItem<'sqlite'> {
  return db
    .update(matchEntries)
    .set({
      upvoteCount: sql`(SELECT COUNT(*) FROM ${matchUpvotes} WHERE ${activeUpvotesOfEntry()})`,
      lastUpvotedAt: latestUpvote(matchUpvotes.upvotedAt),
      lastUpvoteSeq: latestUpvote(matchUpvotes.seq),
      updatedAt: now,
    })
    .where(and(target, acceptingCondition(matchEntries.matchId, now)));
}
