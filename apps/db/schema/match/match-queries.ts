import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { QueryBuilder } from 'drizzle-orm/sqlite-core';

import { matchEntries } from './match-entries.ts';
import { matches } from './matches.ts';

const WINNING_RESULTS = ['won', 'bye', 'walkover'] as const;

// 組み込む側の問い合わせがD1のバインド変数の上限を使えるよう、固定の値を埋め込む
export function qualifierWins() {
  return new QueryBuilder()
    .select({
      launchId: sql<string>`${matchEntries.launchId}`.as('launch_id'),
      productId: sql<string>`${matchEntries.productId}`.as('product_id'),
      upvoteCount: sql<number>`${matchEntries.upvoteCount}`.as('upvote_count'),
      lastUpvotedAt: sql<number | null>`${matchEntries.lastUpvotedAt}`.as(
        'last_upvoted_at',
      ),
      matchDate: sql<string>`${matchEntries.matchDate}`.as('match_date'),
      decidedAt: sql<number>`${matches.decidedAt}`.as('decided_at'),
    })
    .from(matchEntries)
    .innerJoin(matches, eq(matches.id, matchEntries.matchId))
    .where(
      and(
        eq(matchEntries.matchKind, 'qualifier').inlineParams(),
        inArray(matchEntries.result, WINNING_RESULTS).inlineParams(),
        isNotNull(matchEntries.launchId),
        isNotNull(matchEntries.productId),
      ),
    )
    .as('qualifier_wins');
}
