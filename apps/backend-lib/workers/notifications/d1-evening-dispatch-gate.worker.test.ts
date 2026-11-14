import { beforeEach, describe, expect, test } from 'vitest';

import {
  type EveningDispatchError,
  type EveningDispatchReadiness,
} from '../../core/notifications/evening-dispatch.ts';
import { eveningSlot } from '../../core/notifications/notification-slots.ts';
import type { NotificationWorkRequester } from '../../core/notifications/ports.ts';
import { parseBusinessDate } from '../../core/time/business-time.ts';
import { createSequentialIds } from '../identity/testing/identity-store-fixtures.ts';
import { MAX_DELAY_SECONDS } from '../messaging/queue-publisher.ts';
import { D1EveningDispatchGate } from './d1-evening-dispatch-gate.ts';
import { D1NotificationSlotStore } from './d1-notification-slot-store.ts';
import {
  clearNotificationTables,
  db,
  readSlotRow,
} from './testing/notification-store-fixtures.ts';

const DATE = parseBusinessDate('2026-11-20');
const EVENING = eveningSlot(DATE);
const WEEK = 'tournament-week.evening-bracket';
const YEAR = 'tournament-year.evening-bracket';
const MILLISECONDS_PER_SECOND = 1000;
const MILLISECONDS_PER_DAY = 86_400_000;

function secondsAfterDue(seconds: number): Date {
  return new Date(EVENING.dueAt.getTime() + seconds * MILLISECONDS_PER_SECOND);
}

const AT_DUE = EVENING.dueAt;
const AT_READY = secondsAfterDue(5);

interface FlushRequest {
  readonly slotKey: string;
  readonly delaySeconds: number;
}

interface RecordingRequester extends NotificationWorkRequester {
  readonly flushes: FlushRequest[];
}

function createRecordingRequester(): RecordingRequester {
  const flushes: FlushRequest[] = [];
  return {
    flushes,
    flushSlot: (slotKey, delaySeconds) => {
      flushes.push({ slotKey, delaySeconds });
      return Promise.resolve();
    },
    expandEvent: () => Promise.reject(new Error('テストでは使わない')),
  };
}

let idSequence = 1;

function createGate(
  participants: readonly string[],
  requester: NotificationWorkRequester = createRecordingRequester(),
): D1EveningDispatchGate {
  idSequence += 100;
  return new D1EveningDispatchGate(
    db,
    new D1NotificationSlotStore(db, createSequentialIds(idSequence)),
    requester,
    createSequentialIds(idSequence + 50),
    participants,
  );
}

const slots = new D1NotificationSlotStore(db, createSequentialIds(9000));

beforeEach(async () => {
  await clearNotificationTables();
});

describe('markReady', () => {
  test('前提が2つのとき1つ目は残りの名前と待機を返し、2つ目が依頼を記録して送り出しのメッセージを1通だけ送る', async () => {
    const requester = createRecordingRequester();
    const gate = createGate([WEEK, YEAR], requester);
    await gate.open(DATE, AT_DUE);

    await expect(
      gate.markReady({ participant: WEEK, date: DATE, at: AT_READY }),
    ).resolves.toEqual({ kind: 'waiting', missing: [YEAR] });
    await expect(
      gate.markReady({ participant: YEAR, date: DATE, at: AT_READY }),
    ).resolves.toEqual({ kind: 'dispatch-requested' });

    expect(requester.flushes).toEqual([
      { slotKey: EVENING.key, delaySeconds: 600 },
      { slotKey: EVENING.key, delaySeconds: 0 },
    ]);
    expect(await readSlotRow(EVENING.key)).toMatchObject({
      phase: 'waiting',
      requiredParticipants: [WEEK, YEAR],
      dispatchRequestedAt: AT_READY,
    });
  });

  test('依頼の前の同じ機能の繰り返しは待機のままで、依頼の後の呼び出しはどの機能も依頼済みを返して送らない', async () => {
    const requester = createRecordingRequester();
    const gate = createGate([WEEK, YEAR], requester);
    await gate.open(DATE, AT_DUE);

    await gate.markReady({ participant: WEEK, date: DATE, at: AT_READY });
    await expect(
      gate.markReady({ participant: WEEK, date: DATE, at: AT_READY }),
    ).resolves.toEqual({ kind: 'waiting', missing: [YEAR] });
    await gate.markReady({ participant: YEAR, date: DATE, at: AT_READY });
    const sentBefore = requester.flushes.length;

    for (const participant of [WEEK, YEAR]) {
      await expect(
        gate.markReady({ participant, date: DATE, at: secondsAfterDue(30) }),
      ).resolves.toEqual({ kind: 'already-requested' });
    }
    expect(requester.flushes).toHaveLength(sentBefore);
  });

  test('期限の送り出しで待機の段を抜けた枠への呼び出しは、依頼の時刻が無くても依頼済みを返して送らない', async () => {
    const requester = createRecordingRequester();
    const gate = createGate([WEEK, YEAR], requester);
    await gate.open(DATE, AT_DUE);
    await slots.acquireLease(EVENING.key, 'flush', secondsAfterDue(600), 120);
    await slots.advance(
      EVENING.key,
      'flush',
      { phase: 'collecting', cursor: null },
      secondsAfterDue(600),
    );
    const sentBefore = requester.flushes.length;

    await expect(
      gate.markReady({
        participant: WEEK,
        date: DATE,
        at: secondsAfterDue(660),
      }),
    ).resolves.toEqual({ kind: 'already-requested' });
    expect(requester.flushes).toHaveLength(sentBefore);
    expect(await readSlotRow(EVENING.key)).toMatchObject({
      phase: 'collecting',
      dispatchRequestedAt: null,
    });
  });

  test('2つの機能の呼び出しを同時に行っても、依頼と期限の送り出しはそれぞれ1回だけ送られる', async () => {
    const requester = createRecordingRequester();
    const first = createGate([WEEK, YEAR], requester);
    const second = createGate([WEEK, YEAR], requester);

    const results = await Promise.all([
      first.markReady({ participant: WEEK, date: DATE, at: AT_READY }),
      second.markReady({ participant: YEAR, date: DATE, at: AT_READY }),
    ]);

    expect(
      results.filter(({ kind }) => kind === 'dispatch-requested'),
    ).toHaveLength(1);
    expect(
      results.every(({ kind }: EveningDispatchReadiness) =>
        ['dispatch-requested', 'already-requested', 'waiting'].includes(kind),
      ),
    ).toBe(true);
    expect(
      requester.flushes.toSorted((a, b) => a.delaySeconds - b.delaySeconds),
    ).toEqual([
      { slotKey: EVENING.key, delaySeconds: 0 },
      { slotKey: EVENING.key, delaySeconds: 595 },
    ]);
    expect(await readSlotRow(EVENING.key)).toMatchObject({
      requiredParticipants: [WEEK, YEAR],
      dispatchRequestedAt: AT_READY,
    });
  });

  test('登録の無い名前は枠を作らずに拒否し、日付の形式より先に名前を判定する', async () => {
    const requester = createRecordingRequester();
    const gate = createGate([WEEK], requester);

    await expect(
      gate.markReady({ participant: YEAR, date: DATE, at: AT_READY }),
    ).rejects.toMatchObject({
      reason: 'unknown-participant',
    } satisfies Partial<EveningDispatchError>);
    await expect(
      gate.markReady({
        participant: YEAR,
        date: '2026-02-30' as typeof DATE,
        at: AT_READY,
      }),
    ).rejects.toMatchObject({ reason: 'unknown-participant' });
    await expect(
      gate.markReady({
        participant: WEEK,
        date: '2026-02-30' as typeof DATE,
        at: AT_READY,
      }),
    ).rejects.toMatchObject({ reason: 'invalid-date' });
    expect(await readSlotRow(EVENING.key)).toBeUndefined();
    expect(requester.flushes).toEqual([]);
  });

  test('本specのジョブより先に呼ばれたら枠と前提の一覧の写しと期限の送り出しを作り、後のopenは書き直さず依頼もしない', async () => {
    const requester = createRecordingRequester();
    const gate = createGate([WEEK, YEAR], requester);

    await expect(
      gate.markReady({ participant: WEEK, date: DATE, at: AT_READY }),
    ).resolves.toEqual({ kind: 'waiting', missing: [YEAR] });

    expect(await readSlotRow(EVENING.key)).toMatchObject({
      kind: 'evening',
      dueAt: EVENING.dueAt,
      settleUntil: EVENING.settleUntil,
      phase: 'waiting',
      requiredParticipants: [WEEK, YEAR],
      dispatchRequestedAt: null,
    });
    expect(requester.flushes).toEqual([
      { slotKey: EVENING.key, delaySeconds: 595 },
    ]);

    await expect(gate.open(DATE, secondsAfterDue(10))).resolves.toEqual({
      requested: false,
    });
    expect(requester.flushes).toHaveLength(1);
  });

  test('前提の一覧はその夜に最初に確定させた写しで、途中の登録の変更に影響されない', async () => {
    const requester = createRecordingRequester();
    await createGate([WEEK, YEAR], requester).open(DATE, AT_DUE);

    await expect(
      createGate([WEEK], requester).markReady({
        participant: WEEK,
        date: DATE,
        at: AT_READY,
      }),
    ).resolves.toEqual({ kind: 'waiting', missing: [YEAR] });
    await expect(
      createGate(
        [WEEK, YEAR, 'tournament-cup.evening-bracket'],
        requester,
      ).markReady({ participant: YEAR, date: DATE, at: AT_READY }),
    ).resolves.toEqual({ kind: 'dispatch-requested' });
    expect(await readSlotRow(EVENING.key)).toMatchObject({
      requiredParticipants: [WEEK, YEAR],
    });
  });
});

describe('open', () => {
  test('通知の記録が数日前に作った夜の枠に前提の一覧を写して期限の送り出しを依頼し、直ちには依頼しない', async () => {
    await slots.ensure(
      EVENING,
      new Date(EVENING.dueAt.getTime() - 3 * MILLISECONDS_PER_DAY),
    );
    const requester = createRecordingRequester();
    const gate = createGate([WEEK, YEAR], requester);

    await expect(gate.open(DATE, AT_DUE)).resolves.toEqual({
      requested: false,
    });

    expect(requester.flushes).toEqual([
      { slotKey: EVENING.key, delaySeconds: 600 },
    ]);
    expect(await readSlotRow(EVENING.key)).toMatchObject({
      requiredParticipants: [WEEK, YEAR],
      dispatchRequestedAt: null,
      phase: 'waiting',
    });
  });

  test('前提が空なら期限の送り出しに加えて直ちに依頼し、2回目のopenは何も送らない', async () => {
    const requester = createRecordingRequester();
    const gate = createGate([], requester);

    await expect(gate.open(DATE, AT_DUE)).resolves.toEqual({
      requested: true,
    });
    await expect(gate.open(DATE, secondsAfterDue(1))).resolves.toEqual({
      requested: false,
    });

    expect(requester.flushes).toEqual([
      { slotKey: EVENING.key, delaySeconds: 600 },
      { slotKey: EVENING.key, delaySeconds: 0 },
    ]);
    expect(await readSlotRow(EVENING.key)).toMatchObject({
      requiredParticipants: [],
      dispatchRequestedAt: AT_DUE,
    });
  });
});

describe('期限の送り出しの遅延', () => {
  test.each([
    ['23:45:00', 0, 600],
    ['23:45:00.500(端数は切り上げる)', 0.5, 600],
    ['23:50:30', 330, 270],
    ['23:55:00', 600, 0],
    ['23:56:00(0未満は0)', 660, 0],
  ])(
    'openで%sに開くと23:55までの秒数だけ遅らせる',
    async (_label, seconds, expected) => {
      const requester = createRecordingRequester();

      await createGate([WEEK], requester).open(DATE, secondsAfterDue(seconds));

      expect(requester.flushes).toEqual([
        { slotKey: EVENING.key, delaySeconds: expected },
      ]);
    },
  );

  test.each([
    ['23:45:05', 5, 595],
    ['23:50:30', 330, 270],
    ['23:56:00(0未満は0)', 660, 0],
  ])(
    'markReadyが%sに枠を作ると23:55までの秒数だけ遅らせる',
    async (_label, seconds, expected) => {
      const requester = createRecordingRequester();

      await createGate([WEEK, YEAR], requester).markReady({
        participant: WEEK,
        date: DATE,
        at: secondsAfterDue(seconds),
      });

      expect(requester.flushes).toEqual([
        { slotKey: EVENING.key, delaySeconds: expected },
      ]);
    },
  );

  test('23:55まで遅延の上限より長いときは上限の秒数で送る', async () => {
    const requester = createRecordingRequester();

    await createGate([WEEK], requester).open(
      DATE,
      new Date(EVENING.dueAt.getTime() - MILLISECONDS_PER_DAY),
    );

    expect(requester.flushes).toEqual([
      { slotKey: EVENING.key, delaySeconds: MAX_DELAY_SECONDS },
    ]);
  });
});
