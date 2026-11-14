import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { alias, type SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { matchEntries } from '../../../db/schema/match/match-entries.ts';
import { matchEvents } from '../../../db/schema/match/match-events.ts';
import { matches } from '../../../db/schema/match/matches.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { EntryTally } from '../../../lib/core/match/match-decision.ts';
import type {
  DueSettlement,
  SettlementStore,
  SettlementWrite,
} from '../../application/match/ports.ts';

// 1回の一括の書き込みの大きさを日次のジョブの書き込みの単位(50マッチ)に揃える
const MAX_MATCHES_PER_WRITE = 50;

// 外側の文がmatchesを対象にしても列の参照が副問い合わせの側に取られないよう、別名で読む
const settlingMatch = alias(matches, 'settling_match');

function isDue(
  table: {
    readonly startedAt: SQLiteColumn;
    readonly decidedAt: SQLiteColumn;
    readonly endsAt: SQLiteColumn;
  },
  now: Date,
): SQL | undefined {
  return and(
    isNotNull(table.startedAt),
    isNull(table.decidedAt),
    lte(table.endsAt, now),
  );
}

// 書き込みの時点で未確定であることを確かめ、即時の終了が先に確定したマッチを変えない
function settleableCondition(matchIdColumn: SQLiteColumn | SQL, at: Date): SQL {
  return sql`EXISTS (SELECT 1 FROM ${matches} AS ${settlingMatch} WHERE ${and(
    eq(settlingMatch.id, matchIdColumn),
    isDue(settlingMatch, at),
  )})`;
}

function columnsOf(columns: readonly SQLiteColumn[]): SQL {
  return sql.join(
    columns.map((column) => sql.identifier(column.name)),
    sql`, `,
  );
}

@injectable()
export class D1SettlementStore implements SettlementStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  // 対象のマッチを上限まで選ぶ副問い合わせで側を1回に読み、側の数によらずバインド変数を増やさない
  async listDue(now: Date, limit: number): Promise<readonly DueSettlement[]> {
    const dueMatchIds = this.db
      .select({ id: matches.id })
      .from(matches)
      .where(isDue(matches, now))
      .orderBy(asc(matches.endsAt), asc(matches.id))
      .limit(limit);
    const rows = await this.db
      .select({
        matchId: matchEntries.matchId,
        entryId: matchEntries.id,
        upvoteCount: matchEntries.upvoteCount,
        lastUpvotedAt: matchEntries.lastUpvotedAt,
        lastUpvoteSeq: matchEntries.lastUpvoteSeq,
      })
      .from(matchEntries)
      .innerJoin(matches, eq(matches.id, matchEntries.matchId))
      .where(inArray(matchEntries.matchId, dueMatchIds))
      .orderBy(asc(matches.endsAt), asc(matches.id), asc(matchEntries.slot));
    const grouped = new Map<string, EntryTally[]>();
    for (const { matchId, ...tally } of rows) {
      const entries = grouped.get(matchId) ?? [];
      entries.push(tally);
      grouped.set(matchId, entries);
    }
    return [...grouped].map(([matchId, entries]) => ({
      matchId,
      entries,
      entryCount: entries.length === 1 ? 1 : 2,
    }));
  }

  async writeOutcomes(
    outcomes: readonly SettlementWrite[],
    at: Date,
  ): Promise<readonly string[]> {
    if (outcomes.length > MAX_MATCHES_PER_WRITE) {
      throw new RangeError(
        `マッチの確定は1回に${String(MAX_MATCHES_PER_WRITE)}件まで書けます: ${String(outcomes.length)}件`,
      );
    }
    const [first, ...rest] = outcomes.flatMap((item) => [
      this.entryResultsUpdate(item, at),
      this.eventInsert(item, at),
      this.matchUpdate(item, at),
    ]);
    if (first === undefined) {
      return [];
    }
    await this.db.batch([first, ...rest]);
    const rows = await this.db
      .select({ id: matchEvents.id })
      .from(matchEvents)
      .where(
        inArray(
          matchEvents.id,
          outcomes.map((item) => item.eventId),
        ),
      );
    const stored = new Set(rows.map(({ id }) => id));
    return outcomes.flatMap((item) =>
      stored.has(item.eventId) ? [item.eventId] : [],
    );
  }

  async countOverdue(endedBefore: Date): Promise<number> {
    const [row] = await this.db
      .select({ overdue: count() })
      .from(matches)
      .where(and(isNull(matches.decidedAt), lt(matches.endsAt, endedBefore)));
    return row?.overdue ?? 0;
  }

  // Upvote数・最終Upvote時間・記録の順は保存済みの値を確定値として残し、結果だけを書く
  private entryResultsUpdate(
    { matchId, outcome }: SettlementWrite,
    at: Date,
  ): BatchItem<'sqlite'> {
    const results = [...outcome.results];
    const resultCase = sql.join(
      results.map(([entryId, result]) => sql`WHEN ${entryId} THEN ${result}`),
      sql` `,
    );
    return this.db
      .update(matchEntries)
      .set({
        result: sql`CASE ${matchEntries.id} ${resultCase} END`,
        updatedAt: at,
      })
      .where(
        and(
          eq(matchEntries.matchId, matchId),
          inArray(
            matchEntries.id,
            results.map(([entryId]) => entryId),
          ),
          settleableCondition(matchEntries.matchId, at),
        ),
      );
  }

  // マッチの更新より前に置き、同じ一括の書き込みで確定したマッチにだけイベントを作る
  private eventInsert(
    { matchId, eventId }: SettlementWrite,
    at: Date,
  ): BatchItem<'sqlite'> {
    const columns = columnsOf([
      matchEvents.id,
      matchEvents.matchId,
      matchEvents.matchKind,
      matchEvents.type,
      matchEvents.occurredAt,
      matchEvents.status,
      matchEvents.dispatchCount,
      matchEvents.lastDispatchedAt,
      matchEvents.createdAt,
      matchEvents.updatedAt,
    ]);
    const time = at.getTime();
    return this.db.run(
      sql`INSERT INTO ${matchEvents} (${columns}) SELECT ${eventId}, ${matches.id}, ${matches.kind}, 'decided', ${time}, 'pending', 1, ${time}, ${time}, ${time} FROM ${matches} WHERE ${and(
        eq(matches.id, matchId),
        settleableCondition(matches.id, at),
      )} ON CONFLICT (${columnsOf([matchEvents.matchId, matchEvents.type])}) DO NOTHING`,
    );
  }

  private matchUpdate(
    { matchId, outcome }: SettlementWrite,
    at: Date,
  ): BatchItem<'sqlite'> {
    return this.db
      .update(matches)
      .set({ decidedAt: at, decision: outcome.decision, updatedAt: at })
      .where(and(eq(matches.id, matchId), isDue(matches, at)));
  }
}
