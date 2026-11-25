import { describe, expect, test } from 'bun:test';

import type {
  MatchEvent,
  MatchEventType,
} from '../../../lib/core/match/match-events.ts';
import type { MatchKind } from '../../../lib/core/match/match-model.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type { YearEntryRegistrar } from '../../../lib/core/year-tournament/ports.ts';
import { WeekChampionEntryHandler } from './week-champion-entry-handler.ts';

const NOW = new Date('2026-11-29T07:41:30.000Z');

const DECIDED_AT = new Date('2026-11-29T07:40:05.000Z');

const EIGHT_DAYS_BEFORE_DECIDED = new Date('2026-11-21T07:40:05.000Z');

const MATCH_ID = '01JD0MTCH00000000000000001';

const EVENT_ID = '01JD0MEVT00000000000000010';

const ENTRY_ID = '01JD0YENT00000000000000001';

const clock: Clock = { now: () => NOW };

function eventOf(
  type: MatchEventType = 'decided',
  kind: MatchKind = 'week',
): MatchEvent {
  return Object.freeze({
    id: EVENT_ID,
    matchId: MATCH_ID,
    kind,
    type,
    occurredAt: DECIDED_AT,
  });
}

type SyncInput = Parameters<YearEntryRegistrar['syncChampions']>[0];

interface Harness {
  readonly handler: WeekChampionEntryHandler;
  readonly syncs: SyncInput[];
}

function createHarness(failure?: Error): Harness {
  const syncs: SyncInput[] = [];
  const registrar: YearEntryRegistrar = {
    syncChampions: (input) => {
      syncs.push(input);
      return failure === undefined
        ? Promise.resolve({ created: [ENTRY_ID], late: [], skipped: 0 })
        : Promise.reject(failure);
    },
  };
  return {
    handler: new WeekChampionEntryHandler(registrar, clock),
    syncs,
  };
}

describe('Weekのマッチの確定によるWeek優勝の取り込みの処理', () => {
  test('確定の8日前から処理の時刻までのWeek優勝の取り込みを呼んで完了する', async () => {
    const harness = createHarness();

    const outcome = await harness.handler.handle(eventOf());

    expect(outcome).toStrictEqual({ kind: 'done' });
    expect(harness.syncs).toStrictEqual([
      { awardedFrom: EIGHT_DAYS_BEFORE_DECIDED, now: NOW },
    ]);
  });

  test('取り込みの起点はイベントの確定時刻から求め、処理の時刻によらない', async () => {
    const harness = createHarness();
    const delayed: MatchEvent = Object.freeze({
      ...eventOf(),
      occurredAt: new Date('2026-11-27T23:59:59.999Z'),
    });

    await harness.handler.handle(delayed);

    expect(harness.syncs).toStrictEqual([
      { awardedFrom: new Date('2026-11-19T23:59:59.999Z'), now: NOW },
    ]);
  });

  test.each([
    ['予定', 'scheduled', 'week'],
    ['開始', 'started', 'week'],
    ['予選の確定', 'decided', 'qualifier'],
    ['Yearのトーナメントの確定', 'decided', 'year'],
  ] as const)(
    '%sのイベントでは取り込みを呼ばずに完了する',
    async (_, type, kind) => {
      const harness = createHarness();

      expect(await harness.handler.handle(eventOf(type, kind))).toStrictEqual({
        kind: 'done',
      });
      expect(harness.syncs).toStrictEqual([]);
    },
  );

  test('取り込みの失敗は捕まえずに投げ、メッセージの再試行に任せる', async () => {
    const error = new Error('D1 unavailable');
    const harness = createHarness(error);

    const caught = await harness.handler
      .handle(eventOf())
      .catch((thrown: unknown) => thrown);

    expect(caught).toBe(error);
    expect(harness.syncs).toHaveLength(1);
  });
});
