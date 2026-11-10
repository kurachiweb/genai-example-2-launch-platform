import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  notInArray,
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
import type { MatchOutcome } from '../../../lib/core/match/match-decision.ts';
import type {
  DueKickoff,
  KickoffEntry,
  KickoffStore,
  KickoffWrite,
} from '../../application/match/ports.ts';

// 1回の一括の書き込みの大きさを日次のジョブの書き込みの単位(50マッチ)に揃える
const MAX_MATCHES_PER_WRITE = 50;

// 外側の文がmatches・match_entriesを対象にしても列の参照が副問い合わせの側に取られないよう、別名で読む
const kickoffMatch = alias(matches, 'kickoff_match');

const kickoffEntry = alias(matchEntries, 'kickoff_entry');

function isDue(
  table: {
    readonly startedAt: SQLiteColumn;
    readonly decidedAt: SQLiteColumn;
    readonly startsAt: SQLiteColumn;
  },
  now: Date,
): SQL | undefined {
  return and(
    isNull(table.startedAt),
    isNull(table.decidedAt),
    lte(table.startsAt, now),
  );
}

// 書き込みの時点で未開始・未確定であり、判定の後に他の側へ該当が記録されていないことを確かめる。該当の記録は即時の終了の文が同じ未開始の条件で書くため、判定が古いまま開始・決着しない
function writableCondition(
  matchIdColumn: SQLiteColumn,
  { forfeitedEntryIds }: KickoffWrite,
  at: Date,
): SQL {
  const unexpectedForfeit = and(
    eq(kickoffEntry.matchId, matchIdColumn),
    isNotNull(kickoffEntry.forfeitedAt),
    forfeitedEntryIds.length === 0
      ? undefined
      : notInArray(kickoffEntry.id, [...forfeitedEntryIds]),
  );
  return sql`EXISTS (SELECT 1 FROM ${matches} AS ${kickoffMatch} WHERE ${and(
    eq(kickoffMatch.id, matchIdColumn),
    isDue(kickoffMatch, at),
  )}) AND NOT EXISTS (SELECT 1 FROM ${matchEntries} AS ${kickoffEntry} WHERE ${unexpectedForfeit})`;
}

function columnsOf(columns: readonly SQLiteColumn[]): SQL {
  return sql.join(
    columns.map((column) => sql.identifier(column.name)),
    sql`, `,
  );
}

function decidedOutcomeOf({ outcome }: KickoffWrite): MatchOutcome | undefined {
  return outcome.kind === 'decided' ? outcome.outcome : undefined;
}

@injectable()
export class D1KickoffStore implements KickoffStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  // 対象のマッチを上限まで選ぶ副問い合わせで側を1回に読み、側の数によらずバインド変数を増やさない
  async listDue(now: Date, limit: number): Promise<readonly DueKickoff[]> {
    const dueMatchIds = this.db
      .select({ id: matches.id })
      .from(matches)
      .where(isDue(matches, now))
      .orderBy(asc(matches.startsAt), asc(matches.id))
      .limit(limit);
    const rows = await this.db
      .select({
        matchId: matches.id,
        kind: matches.kind,
        startsAt: matches.startsAt,
        entryId: matchEntries.id,
        launchId: matchEntries.launchId,
        productId: matchEntries.productId,
        forfeitedAt: matchEntries.forfeitedAt,
      })
      .from(matchEntries)
      .innerJoin(matches, eq(matches.id, matchEntries.matchId))
      .where(inArray(matchEntries.matchId, dueMatchIds))
      .orderBy(asc(matches.startsAt), asc(matches.id), asc(matchEntries.slot));
    const grouped = new Map<
      string,
      Omit<DueKickoff, 'entries'> & { readonly entries: KickoffEntry[] }
    >();
    for (const row of rows) {
      const match = grouped.get(row.matchId) ?? {
        matchId: row.matchId,
        kind: row.kind,
        startsAt: row.startsAt,
        entries: [],
      };
      match.entries.push({
        entryId: row.entryId,
        launchId: row.launchId,
        productId: row.productId,
        forfeited: row.forfeitedAt !== null,
      });
      grouped.set(row.matchId, match);
    }
    return [...grouped.values()];
  }

  async writeKickoffs(
    items: readonly KickoffWrite[],
    at: Date,
  ): Promise<readonly string[]> {
    if (items.length > MAX_MATCHES_PER_WRITE) {
      throw new RangeError(
        `マッチの開始は1回に${String(MAX_MATCHES_PER_WRITE)}件まで書けます: ${String(items.length)}件`,
      );
    }
    const [first, ...rest] = items.flatMap((item) => [
      ...this.entryResultsUpdate(item, at),
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
          items.map((item) => item.eventId),
        ),
      );
    const stored = new Set(rows.map(({ id }) => id));
    return items.flatMap((item) =>
      stored.has(item.eventId) ? [item.eventId] : [],
    );
  }

  private entryResultsUpdate(
    item: KickoffWrite,
    at: Date,
  ): BatchItem<'sqlite'>[] {
    const outcome = decidedOutcomeOf(item);
    if (outcome === undefined) {
      return [];
    }
    const results = [...outcome.results];
    const resultCase = sql.join(
      results.map(([entryId, result]) => sql`WHEN ${entryId} THEN ${result}`),
      sql` `,
    );
    return [
      this.db
        .update(matchEntries)
        .set({
          result: sql`CASE ${matchEntries.id} ${resultCase} END`,
          updatedAt: at,
        })
        .where(
          and(
            eq(matchEntries.matchId, item.matchId),
            inArray(
              matchEntries.id,
              results.map(([entryId]) => entryId),
            ),
            writableCondition(matchEntries.matchId, item, at),
          ),
        ),
    ];
  }

  // マッチの更新より前に置き、同じ一括の書き込みで開始・決着したマッチにだけイベントを作る
  private eventInsert(item: KickoffWrite, at: Date): BatchItem<'sqlite'> {
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
    const type = item.outcome.kind === 'start' ? 'started' : 'decided';
    const time = at.getTime();
    return this.db.run(
      sql`INSERT INTO ${matchEvents} (${columns}) SELECT ${item.eventId}, ${matches.id}, ${matches.kind}, ${type}, ${time}, 'pending', 1, ${time}, ${time}, ${time} FROM ${matches} WHERE ${and(
        eq(matches.id, item.matchId),
        writableCondition(matches.id, item, at),
      )} ON CONFLICT (${columnsOf([matchEvents.matchId, matchEvents.type])}) DO NOTHING`,
    );
  }

  private matchUpdate(item: KickoffWrite, at: Date): BatchItem<'sqlite'> {
    const outcome = decidedOutcomeOf(item);
    return this.db
      .update(matches)
      .set({
        startedAt: at,
        updatedAt: at,
        ...(outcome === undefined
          ? {}
          : { decidedAt: at, decision: outcome.decision }),
      })
      .where(
        and(
          eq(matches.id, item.matchId),
          writableCondition(matches.id, item, at),
        ),
      );
  }
}
