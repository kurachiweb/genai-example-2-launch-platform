import { asc, eq } from 'drizzle-orm';

import { matchEntries } from '../../../../db/schema/match/match-entries.ts';
import { matchEventHandlerRuns } from '../../../../db/schema/match/match-event-handler-runs.ts';
import { matchEvents } from '../../../../db/schema/match/match-events.ts';
import { matches } from '../../../../db/schema/match/matches.ts';
import type { IdGenerator } from '../../../core/ids/id-generator.ts';
import type { MatchEventDispatcher } from '../../../core/match/ports.ts';
import type { MessagePublisher } from '../../messaging/queue-publisher.ts';
import { db, T0 } from '../../product/testing/product-fixtures.ts';
import { matchIdOf } from './match-fixtures.ts';

// 1行が11個のバインド変数を使うため、上限(100)に収まる行数ずつ追加する
const ROWS_PER_INSERT = 8;

type EventRow = typeof matchEvents.$inferInsert;

export function matchEventIdOf(index: number): string {
  return `01JD0MEVT${String(index).padStart(17, '0')}`;
}

export function sequentialIdOf(index: number): string {
  return `01JD0MSEQ${String(index).padStart(17, '0')}`;
}

function handlerRunIdOf(index: number): string {
  return `01JD0MRUN${String(index).padStart(17, '0')}`;
}

// 検証で作った行の識別子を予測できるよう、指定した番号から順に識別子を作る
export function createSequentialIds(start = 1): IdGenerator {
  let next = start;
  return {
    generate: () => {
      const id = sequentialIdOf(next);
      next += 1;
      return id;
    },
  };
}

export interface MatchEventFixture {
  readonly index: number;
  readonly match: number;
  readonly type: EventRow['type'];
  readonly occurredAt: Date;
  readonly columns?: Partial<EventRow>;
}

function eventRowOf(fixture: MatchEventFixture): EventRow {
  return {
    id: matchEventIdOf(fixture.index),
    matchId: matchIdOf(fixture.match),
    matchKind: 'qualifier',
    type: fixture.type,
    occurredAt: fixture.occurredAt,
    status: 'pending',
    dispatchCount: 1,
    lastDispatchedAt: fixture.occurredAt,
    createdAt: T0,
    updatedAt: T0,
    ...fixture.columns,
  };
}

export async function insertMatchEvents(
  fixtures: readonly MatchEventFixture[],
): Promise<void> {
  const rows = fixtures.map(eventRowOf);
  for (let start = 0; start < rows.length; start += ROWS_PER_INSERT) {
    await db
      .insert(matchEvents)
      .values(rows.slice(start, start + ROWS_PER_INSERT));
  }
}

export async function insertHandlerRun(
  index: number,
  eventIndex: number,
  handlerName: string,
): Promise<void> {
  await db.insert(matchEventHandlerRuns).values({
    id: handlerRunIdOf(index),
    eventId: matchEventIdOf(eventIndex),
    handlerName,
    completedAt: T0,
    createdAt: T0,
    updatedAt: T0,
  });
}

export async function readMatchEvents() {
  return db
    .select()
    .from(matchEvents)
    .orderBy(asc(matchEvents.matchId), asc(matchEvents.id));
}

export async function readMatchEvent(eventId: string) {
  const [row] = await db
    .select()
    .from(matchEvents)
    .where(eq(matchEvents.id, eventId));
  return row;
}

export async function readHandlerRuns() {
  return db
    .select({
      eventId: matchEventHandlerRuns.eventId,
      handlerName: matchEventHandlerRuns.handlerName,
      completedAt: matchEventHandlerRuns.completedAt,
    })
    .from(matchEventHandlerRuns)
    .orderBy(
      asc(matchEventHandlerRuns.eventId),
      asc(matchEventHandlerRuns.handlerName),
    );
}

export async function readMatchRows() {
  return db.select().from(matches).orderBy(asc(matches.id));
}

export async function readEntryRows() {
  return db
    .select()
    .from(matchEntries)
    .orderBy(asc(matchEntries.matchId), asc(matchEntries.slot));
}

export interface RecordingDispatcher extends MatchEventDispatcher {
  readonly published: (readonly string[])[];
  // 送信の時点で記録済みだったイベントのID
  readonly committedAtPublish: (readonly string[])[];
}

// 確定の後に送ることを確かめるため、送信の時点でイベントの行が読めるかを記録する
export function createRecordingDispatcher(): RecordingDispatcher {
  const published: (readonly string[])[] = [];
  const committedAtPublish: (readonly string[])[] = [];
  return {
    published,
    committedAtPublish,
    async publish(eventIds) {
      published.push([...eventIds]);
      const rows = await readMatchEvents();
      const stored = new Set(rows.map((row) => row.id));
      committedAtPublish.push(eventIds.filter((id) => stored.has(id)));
    },
  };
}

export interface ControlledPublisher extends MessagePublisher {
  readonly bodies: unknown[];
  maxInFlight(): number;
}

// 並行数を確かめるため、送信を1ティック遅らせて同時に処理中の数を数える。failsが真を返す本文のIDの送信は失敗させる
export function createControlledPublisher(
  fails: (eventId: string) => boolean = () => false,
): ControlledPublisher {
  const bodies: unknown[] = [];
  let inFlight = 0;
  let peak = 0;
  return {
    bodies,
    maxInFlight: () => peak,
    async publish(_contract, body) {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      const { eventId } = body as { readonly eventId: string };
      if (fails(eventId)) {
        throw new Error('Queueへの送信に失敗しました');
      }
      bodies.push(body);
      return `envelope-${eventId}`;
    },
  };
}
