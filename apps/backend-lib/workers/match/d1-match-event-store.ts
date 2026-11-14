import { and, asc, eq, gte, inArray, lt, notExists, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { matchEventHandlerRuns } from '../../../db/schema/match/match-event-handler-runs.ts';
import { matchEvents } from '../../../db/schema/match/match-events.ts';
import { matches } from '../../../db/schema/match/matches.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type { IdGenerator } from '../../core/ids/id-generator.ts';
import type {
  MatchEventStore,
  StoredMatchEvent,
} from '../../core/match/ports.ts';

const events = matchEvents;
const handlerRuns = matchEventHandlerRuns;

// D1のバインド変数の上限(100)から、IDの一覧以外の条件と更新値に使う変数の分を残す
const IDS_PER_STATEMENT = 90;

// イベントの1行は11個のバインド変数を使うため、上限(100)に収まる行数ずつ追加する
const EVENT_ROWS_PER_STATEMENT = 8;

const STORED_EVENT_COLUMNS = {
  id: events.id,
  matchId: events.matchId,
  kind: events.matchKind,
  type: events.type,
  occurredAt: events.occurredAt,
  status: events.status,
  dispatchCount: events.dispatchCount,
  lastDispatchedAt: events.lastDispatchedAt,
};

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

@injectable()
export class D1MatchEventStore implements MatchEventStore {
  constructor(
    @inject(PLATFORM_TYPES.Database) private readonly db: Database,
    @inject(PLATFORM_TYPES.IdGenerator) private readonly ids: IdGenerator,
  ) {}

  async findEvent(eventId: string): Promise<StoredMatchEvent | undefined> {
    const [row] = await this.db
      .select(STORED_EVENT_COLUMNS)
      .from(events)
      .where(eq(events.id, eventId));
    return row;
  }

  async findOldestPending(
    matchId: string,
  ): Promise<StoredMatchEvent | undefined> {
    const [row] = await this.db
      .select(STORED_EVENT_COLUMNS)
      .from(events)
      .where(and(eq(events.matchId, matchId), eq(events.status, 'pending')))
      .orderBy(asc(events.occurredAt), asc(events.id))
      .limit(1);
    return row;
  }

  async completedHandlers(eventId: string): Promise<ReadonlySet<string>> {
    const rows = await this.db
      .select({ handlerName: handlerRuns.handlerName })
      .from(handlerRuns)
      .where(eq(handlerRuns.eventId, eventId));
    return new Set(rows.map((row) => row.handlerName));
  }

  async markHandlerCompleted(
    eventId: string,
    handlerName: string,
    at: Date,
  ): Promise<void> {
    await this.db
      .insert(handlerRuns)
      .values({
        id: this.ids.generate(),
        eventId,
        handlerName,
        completedAt: at,
        createdAt: at,
        updatedAt: at,
      })
      .onConflictDoNothing({
        target: [handlerRuns.eventId, handlerRuns.handlerName],
      });
  }

  async markEventCompleted(eventId: string, at: Date): Promise<void> {
    await this.db
      .update(events)
      .set({ status: 'completed', completedAt: at, updatedAt: at })
      .where(and(eq(events.id, eventId), eq(events.status, 'pending')));
  }

  // 確定の日時を発生日時にし、同じマッチの開始のイベントより後に処理させる
  async createMissingDecidedEvents(
    decidedSince: Date,
    at: Date,
    limit: number,
  ): Promise<readonly string[]> {
    const candidates = await this.db
      .select({
        matchId: matches.id,
        kind: matches.kind,
        decidedAt: matches.decidedAt,
      })
      .from(matches)
      .where(
        and(
          gte(matches.decidedAt, decidedSince),
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(events)
              .where(
                and(eq(events.matchId, matches.id), eq(events.type, 'decided')),
              ),
          ),
        ),
      )
      .orderBy(asc(matches.decidedAt), asc(matches.id))
      .limit(limit);
    const rows = candidates.map((candidate) => ({
      id: this.ids.generate(),
      matchId: candidate.matchId,
      matchKind: candidate.kind,
      type: 'decided' as const,
      occurredAt: candidate.decidedAt ?? at,
      status: 'pending' as const,
      dispatchCount: 1,
      lastDispatchedAt: at,
      createdAt: at,
      updatedAt: at,
    }));
    // 同時に動いた掃き出しが先に作った行は(match_id, type)の一意索引に当たって無視され、作った行だけが返る
    const pages = await this.runAll(
      chunk(rows, EVENT_ROWS_PER_STATEMENT).map((page) =>
        this.db
          .insert(events)
          .values(page)
          .onConflictDoNothing({ target: [events.matchId, events.type] })
          .returning({ id: events.id }),
      ),
    );
    const created = new Set(pages.flat().map((row) => row.id));
    return rows.flatMap((row) => (created.has(row.id) ? [row.id] : []));
  }

  async listStalePending(
    dispatchedBefore: Date,
    limit: number,
  ): Promise<readonly StoredMatchEvent[]> {
    return this.db
      .select(STORED_EVENT_COLUMNS)
      .from(events)
      .where(
        and(
          eq(events.status, 'pending'),
          lt(events.lastDispatchedAt, dispatchedBefore),
        ),
      )
      .orderBy(asc(events.lastDispatchedAt), asc(events.id))
      .limit(limit);
  }

  async markRedispatched(eventIds: readonly string[], at: Date): Promise<void> {
    await this.runAll(
      chunk([...new Set(eventIds)], IDS_PER_STATEMENT).map((page) =>
        this.db
          .update(events)
          .set({
            dispatchCount: sql`${events.dispatchCount} + 1`,
            lastDispatchedAt: at,
            updatedAt: at,
          })
          .where(and(inArray(events.id, page), eq(events.status, 'pending'))),
      ),
    );
  }

  async deleteCompletedBefore(
    completedBefore: Date,
    limit: number,
  ): Promise<number> {
    const targets = await this.db
      .select({ id: events.id })
      .from(events)
      .where(
        and(
          eq(events.status, 'completed'),
          lt(events.completedAt, completedBefore),
        ),
      )
      .orderBy(asc(events.completedAt), asc(events.id))
      .limit(limit);
    // 処理の記録はイベントを外部キーで参照するため、同じ一括の書き込みの中で先に消す
    const results = await this.runAll(
      chunk(
        targets.map((target) => target.id),
        IDS_PER_STATEMENT,
      ).flatMap((page) => [
        this.db.delete(handlerRuns).where(inArray(handlerRuns.eventId, page)),
        this.db
          .delete(events)
          .where(and(inArray(events.id, page), eq(events.status, 'completed')))
          .returning({ id: events.id }),
      ]),
    );
    let deleted = 0;
    for (const result of results) {
      if (Array.isArray(result)) {
        deleted += result.length;
      }
    }
    return deleted;
  }

  // 分割した文を1つの一括の書き込みにまとめ、途中で失敗した場合に一部だけが変わった状態を残さない
  private async runAll<T extends BatchItem<'sqlite'>>(
    statements: readonly T[],
  ) {
    const [first, ...rest] = statements;
    if (first === undefined) {
      return [];
    }
    return this.db.batch([first, ...rest]);
  }
}
