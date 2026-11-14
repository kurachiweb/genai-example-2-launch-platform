import { inArray, type SQL, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { matchEntries } from '../../../db/schema/match/match-entries.ts';
import { matchEvents } from '../../../db/schema/match/match-events.ts';
import { matches } from '../../../db/schema/match/matches.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type { IdGenerator } from '../../core/ids/id-generator.ts';
import { MATCH_PLATFORM_TYPES } from '../../core/match/identifiers.ts';
import type {
  MatchEventDispatcher,
  MatchScheduleInput,
  MatchScheduler,
  ScheduledEntryInput,
} from '../../core/match/ports.ts';

// 1回の一括の書き込みの大きさを日次のジョブの書き込みの単位(50マッチ)に揃える
const MAX_MATCHES_PER_SCHEDULE = 50;

function columnsOf(columns: readonly SQLiteColumn[]): SQL {
  return sql.join(
    columns.map((column) => sql.identifier(column.name)),
    sql`, `,
  );
}

function valuesOf(values: readonly unknown[]): SQL {
  return sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  );
}

// 既に予選に組まれたローンチを含むマッチは行ごと作らない。種別の値を埋め込み、予選の側のローンチの部分一意索引の条件と照合させる
function launchesAvailable(input: MatchScheduleInput): SQL {
  if (input.kind !== 'qualifier') {
    return sql`1`;
  }
  const launchIds = input.entries.map((entry) => entry.launchId);
  return sql`NOT EXISTS (SELECT 1 FROM ${matchEntries} WHERE ${matchEntries.matchKind} = 'qualifier' AND ${inArray(matchEntries.launchId, launchIds)})`;
}

@injectable()
export class D1MatchScheduler implements MatchScheduler {
  constructor(
    @inject(PLATFORM_TYPES.Database) private readonly db: Database,
    @inject(MATCH_PLATFORM_TYPES.MatchEventDispatcher)
    private readonly dispatcher: MatchEventDispatcher,
    @inject(PLATFORM_TYPES.IdGenerator) private readonly ids: IdGenerator,
  ) {}

  async schedule(
    inputs: readonly MatchScheduleInput[],
    at: Date,
  ): Promise<{
    readonly created: readonly string[];
    readonly skipped: readonly string[];
  }> {
    if (inputs.length > MAX_MATCHES_PER_SCHEDULE) {
      throw new RangeError(
        `マッチの予定は1回に${String(MAX_MATCHES_PER_SCHEDULE)}件まで作れます: ${String(inputs.length)}件`,
      );
    }
    const planned = inputs.map((input) => ({
      input,
      eventId: this.ids.generate(),
    }));
    const [first, ...rest] = planned.flatMap(({ input, eventId }) => [
      this.matchInsert(input, at),
      ...input.entries.map((entry, index) =>
        this.entryInsert(input.matchId, index + 1, entry, at),
      ),
      this.eventInsert(input.matchId, eventId, at),
    ]);
    if (first === undefined) {
      return { created: [], skipped: [] };
    }
    await this.db.batch([first, ...rest]);
    const rows = await this.db
      .select({ id: matchEvents.id })
      .from(matchEvents)
      .where(
        inArray(
          matchEvents.id,
          planned.map(({ eventId }) => eventId),
        ),
      );
    const stored = new Set(rows.map(({ id }) => id));
    const created = planned.filter(({ eventId }) => stored.has(eventId));
    if (created.length > 0) {
      await this.dispatcher.publish(created.map(({ eventId }) => eventId));
    }
    return {
      created: created.map(({ input }) => input.matchId),
      skipped: planned
        .filter(({ eventId }) => !stored.has(eventId))
        .map(({ input }) => input.matchId),
    };
  }

  // 既にあるマッチのIDは主キーで、既に予選に組まれたローンチは条件で飛ばす。INSERT … SELECTにON CONFLICTを続けるため、SELECTにWHEREを付ける
  private matchInsert(
    input: MatchScheduleInput,
    at: Date,
  ): BatchItem<'sqlite'> {
    const columns = columnsOf([
      matches.id,
      matches.kind,
      matches.matchDate,
      matches.round,
      matches.stage,
      matches.startsAt,
      matches.endsAt,
      matches.createdAt,
      matches.updatedAt,
    ]);
    const values = valuesOf([
      input.matchId,
      input.kind,
      input.matchDate,
      input.round,
      input.stage,
      input.startsAt.getTime(),
      input.endsAt.getTime(),
      at.getTime(),
      at.getTime(),
    ]);
    return this.db.run(
      sql`INSERT INTO ${matches} (${columns}) SELECT ${values} WHERE ${launchesAvailable(input)} ON CONFLICT DO NOTHING`,
    );
  }

  // 種別と実施日はマッチの行から写し、マッチを作らなかった場合は何も追加しない。再実行で既にある側だけを(match_id, slot)の一意索引で無視し、同じ予選の2つの側に同じローンチを渡す誤りは予選の側のローンチの部分一意索引の違反で一括の書き込み全体を取り消す
  private entryInsert(
    matchId: string,
    slot: number,
    entry: ScheduledEntryInput,
    at: Date,
  ): BatchItem<'sqlite'> {
    const columns = columnsOf([
      matchEntries.id,
      matchEntries.matchId,
      matchEntries.slot,
      matchEntries.matchKind,
      matchEntries.matchDate,
      matchEntries.launchId,
      matchEntries.productId,
      matchEntries.ownerUserId,
      matchEntries.createdAt,
      matchEntries.updatedAt,
    ]);
    return this.db.run(
      sql`INSERT INTO ${matchEntries} (${columns}) SELECT ${this.ids.generate()}, ${matches.id}, ${slot}, ${matches.kind}, ${matches.matchDate}, ${entry.launchId}, ${entry.productId}, ${entry.ownerUserId}, ${at.getTime()}, ${at.getTime()} FROM ${matches} WHERE ${matches.id} = ${matchId} ON CONFLICT (${columnsOf([matchEntries.matchId, matchEntries.slot])}) DO NOTHING`,
    );
  }

  // 再実行で既にある予定のイベントは(match_id, type)の一意索引で無視し、書き込んだかを後の読み取りで判定する
  private eventInsert(
    matchId: string,
    eventId: string,
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
    return this.db.run(
      sql`INSERT INTO ${matchEvents} (${columns}) SELECT ${eventId}, ${matches.id}, ${matches.kind}, 'scheduled', ${at.getTime()}, 'pending', 1, ${at.getTime()}, ${at.getTime()}, ${at.getTime()} FROM ${matches} WHERE ${matches.id} = ${matchId} ON CONFLICT (${columnsOf([matchEvents.matchId, matchEvents.type])}) DO NOTHING`,
    );
  }
}
