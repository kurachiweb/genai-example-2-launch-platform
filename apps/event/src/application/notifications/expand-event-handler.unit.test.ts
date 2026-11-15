import { describe, expect, test } from 'bun:test';

import {
  awardSlot,
  eveningSlot,
  morningSlot,
} from '../../../lib/core/notifications/notification-slots.ts';
import type {
  NotificationEventExpander,
  NotificationEventExpansion,
  NotificationWorkRequester,
} from '../../../lib/core/notifications/ports.ts';
import { parseBusinessDate } from '../../../lib/core/time/business-time.ts';
import {
  EXPAND_EVENT_BUDGET,
  ExpandEventHandler,
} from './expand-event-handler.ts';

const EVENT_ID = '01M7BNN5000000000000000002';
const NOW = new Date('2026-11-23T00:10:05.000Z');

const AWARD = awardSlot(EVENT_ID, new Date('2026-11-23T00:10:00.000Z'));
const EVENING = eveningSlot(parseBusinessDate('2026-11-20'));
const MORNING = morningSlot(parseBusinessDate('2026-11-21'));

interface ExpandCall {
  readonly eventId: string;
  readonly now: Date;
  readonly budget: number;
}

interface FlushCall {
  readonly slotKey: string;
  readonly delaySeconds: number;
}

interface Harness {
  readonly handler: ExpandEventHandler;
  readonly expansions: ExpandCall[];
  readonly flushes: FlushCall[];
  outcomes: (NotificationEventExpansion | Error)[];
  flushFailure: Error | undefined;
}

function createHarness(): Harness {
  const expansions: ExpandCall[] = [];
  const flushes: FlushCall[] = [];
  const expander: NotificationEventExpander = {
    expand: (eventId, now, budget) => {
      expansions.push({ eventId, now, budget });
      const outcome = harness.outcomes.shift();
      if (outcome === undefined) {
        throw new Error('展開の結果が用意されていない');
      }
      return outcome instanceof Error
        ? Promise.reject(outcome)
        : Promise.resolve(outcome);
    },
  };
  const requester: NotificationWorkRequester = {
    flushSlot: (slotKey, delaySeconds) => {
      flushes.push({ slotKey, delaySeconds });
      return harness.flushFailure === undefined
        ? Promise.resolve()
        : Promise.reject(harness.flushFailure);
    },
    expandEvent: () => {
      throw new Error('展開の処理は展開の依頼を使わない');
    },
  };
  const harness: Harness = {
    handler: new ExpandEventHandler(expander, requester, { now: () => NOW }),
    expansions,
    flushes,
    outcomes: [],
    flushFailure: undefined,
  };
  return harness;
}

function expand(harness: Harness) {
  return harness.handler.handle({ eventId: EVENT_ID });
}

// 処理が投げた例外を返し、例外にならなければテストを失敗させる
async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('処理が例外にならなかった');
}

describe('ExpandEventHandler.handle', () => {
  test('処理の時点の時刻と1回の上限2,000件で通知イベントを展開する', async () => {
    const harness = createHarness();
    harness.outcomes = [
      { kind: 'done', lateSlotKeys: [], flushSlotKey: AWARD.key },
    ];

    await expand(harness);

    expect(harness.expansions).toStrictEqual([
      { eventId: EVENT_ID, now: NOW, budget: 2000 },
    ]);
    expect(EXPAND_EVENT_BUDGET).toBe(2000);
  });

  test('展開の続きがあれば、送り出しを依頼せずに1秒のdeferをする', async () => {
    const harness = createHarness();
    harness.outcomes = [{ kind: 'continue' }];

    expect(await expand(harness)).toStrictEqual({
      kind: 'defer',
      delaySeconds: 1,
    });
    expect(harness.flushes).toStrictEqual([]);
  });

  test('続きのdeferの後に同じ封筒が届けば、展開を続けて完了で送り出しを依頼する', async () => {
    const harness = createHarness();
    harness.outcomes = [
      { kind: 'continue' },
      { kind: 'done', lateSlotKeys: [], flushSlotKey: AWARD.key },
    ];

    await expand(harness);
    expect(await expand(harness)).toStrictEqual({ kind: 'done' });

    expect(harness.expansions).toHaveLength(2);
    expect(harness.flushes).toStrictEqual([
      { slotKey: AWARD.key, delaySeconds: 0 },
    ]);
  });

  test('完了したら受賞の枠の送り出しを遅延0秒で依頼して完了する', async () => {
    const harness = createHarness();
    harness.outcomes = [
      { kind: 'done', lateSlotKeys: [], flushSlotKey: AWARD.key },
    ];

    expect(await expand(harness)).toStrictEqual({ kind: 'done' });
    expect(harness.flushes).toStrictEqual([
      { slotKey: AWARD.key, delaySeconds: 0 },
    ]);
  });

  test('完了したら遅れた枠と受賞の枠の送り出しを、それぞれ遅延0秒で依頼する', async () => {
    const harness = createHarness();
    harness.outcomes = [
      {
        kind: 'done',
        lateSlotKeys: [EVENING.key, MORNING.key],
        flushSlotKey: AWARD.key,
      },
    ];

    expect(await expand(harness)).toStrictEqual({ kind: 'done' });
    expect(harness.flushes).toStrictEqual([
      { slotKey: EVENING.key, delaySeconds: 0 },
      { slotKey: MORNING.key, delaySeconds: 0 },
      { slotKey: AWARD.key, delaySeconds: 0 },
    ]);
  });

  test('完了の枠と遅れた枠が同じキーなら、送り出しを1回だけ依頼する', async () => {
    const harness = createHarness();
    harness.outcomes = [
      { kind: 'done', lateSlotKeys: [AWARD.key], flushSlotKey: AWARD.key },
    ];

    await expand(harness);

    expect(harness.flushes).toStrictEqual([
      { slotKey: AWARD.key, delaySeconds: 0 },
    ]);
  });

  test('送り出す枠が無い完了は、依頼をせずに完了する', async () => {
    const harness = createHarness();
    harness.outcomes = [{ kind: 'done', lateSlotKeys: [], flushSlotKey: null }];

    expect(await expand(harness)).toStrictEqual({ kind: 'done' });
    expect(harness.flushes).toStrictEqual([]);
  });

  test('遅れた枠だけの完了は、遅れた枠の送り出しだけを依頼する', async () => {
    const harness = createHarness();
    harness.outcomes = [
      { kind: 'done', lateSlotKeys: [EVENING.key], flushSlotKey: null },
    ];

    await expand(harness);

    expect(harness.flushes).toStrictEqual([
      { slotKey: EVENING.key, delaySeconds: 0 },
    ]);
  });

  describe('失敗と再開', () => {
    test('展開の例外はそのまま投げ、送り出しを依頼しない', async () => {
      const harness = createHarness();
      const failure = new Error('フォロワーの照会の失敗');
      harness.outcomes = [failure];

      expect(await failureOf(expand(harness))).toBe(failure);
      expect(harness.flushes).toStrictEqual([]);
    });

    test('送り出しの依頼の例外はそのまま投げ、再試行で展開済みの受賞の枠の依頼をやり直す', async () => {
      const harness = createHarness();
      const failure = new Error('Queueへの送信の失敗');
      harness.flushFailure = failure;
      harness.outcomes = [
        { kind: 'done', lateSlotKeys: [], flushSlotKey: AWARD.key },
        { kind: 'done', lateSlotKeys: [], flushSlotKey: AWARD.key },
      ];

      expect(await failureOf(expand(harness))).toBe(failure);

      harness.flushFailure = undefined;
      expect(await expand(harness)).toStrictEqual({ kind: 'done' });
      expect(harness.flushes).toStrictEqual([
        { slotKey: AWARD.key, delaySeconds: 0 },
        { slotKey: AWARD.key, delaySeconds: 0 },
      ]);
    });
  });
});
