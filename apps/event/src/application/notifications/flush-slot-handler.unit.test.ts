import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type { MessageMeta } from '../../../lib/core/messaging/message-contract.ts';
import {
  awardSlot,
  eveningSlot,
  morningSlot,
  type NotificationSlot,
} from '../../../lib/core/notifications/notification-slots.ts';
import type {
  NotificationIncident,
  NotificationSlotStore,
  SlotProgress,
  StoredSlot,
} from '../../../lib/core/notifications/ports.ts';
import {
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../../lib/core/time/business-time.ts';
import {
  FLUSH_SLOT_DISPATCH_LIMIT,
  FLUSH_SLOT_LEASE_SECONDS,
  FLUSH_SLOT_LEASE_WAIT_SECONDS,
  FlushSlotHandler,
} from './flush-slot-handler.ts';
import type {
  GroupDispatcher,
  GroupDispatchStep,
  SlotCollector,
  SlotCollectStep,
} from './ports.ts';

const DATE = parseBusinessDate('2026-11-20');
const EVENING = eveningSlot(DATE);
const MORNING = morningSlot(DATE);
const AWARD = awardSlot(
  '01M7BNN5000000000000000002',
  new Date('2026-11-23T00:10:00.000Z'),
);

const BEFORE_DEADLINE = fromBusinessDateTime(DATE, { hour: 23, minute: 54 });
const AT_DEADLINE = fromBusinessDateTime(DATE, { hour: 23, minute: 55 });
const LAST_SECOND_BEFORE_DEADLINE = new Date(AT_DEADLINE.getTime() - 1000);
const AFTER_READY = fromBusinessDateTime(DATE, { hour: 23, minute: 46 });

const META: MessageMeta = {
  id: '01JD0NTFY00000000000000001',
  type: 'notifications.flush-slot',
  attempts: 1,
  sentAt: new Date('2026-11-20T14:45:00.000Z'),
};

const OTHER_HOLDER = '01JD0NTFY00000000000000002';

type Call =
  | {
      readonly kind: 'acquire';
      readonly holder: string;
      readonly seconds: number;
    }
  | { readonly kind: 'release'; readonly holder: string }
  | {
      readonly kind: 'advance';
      readonly change: SlotProgress;
      readonly at: Date;
    }
  | { readonly kind: 'request'; readonly at: Date }
  | {
      readonly kind: 'collect';
      readonly collector: string;
      readonly cursor: string | null;
    }
  | {
      readonly kind: 'dispatch';
      readonly slotKey: string;
      readonly now: Date;
      readonly limit: number;
    };

function notUsed(): never {
  throw new Error('送り出しの処理はこの操作を使わない');
}

interface Lease {
  readonly holder: string;
  readonly until: Date;
}

class FakeSlotStore implements NotificationSlotStore {
  readonly slots = new Map<string, StoredSlot>();
  readonly leases = new Map<string, Lease>();
  missing: readonly string[] | null = null;
  missingFailures: Error[] = [];

  constructor(private readonly calls: Call[]) {}

  put(slot: NotificationSlot, columns: Partial<StoredSlot> = {}): void {
    this.slots.set(slot.key, {
      ...slot,
      phase: 'waiting',
      cursor: null,
      requiredParticipants: null,
      dispatchRequestedAt: slot.kind === 'evening' ? null : slot.dueAt,
      ...columns,
    });
  }

  slot(key: string): StoredSlot {
    const stored = this.slots.get(key);
    if (stored === undefined) {
      throw new Error(`枠が無い: ${key}`);
    }
    return stored;
  }

  find(key: string) {
    return Promise.resolve(this.slots.get(key));
  }

  acquireLease(key: string, holder: string, now: Date, seconds: number) {
    this.calls.push({ kind: 'acquire', holder, seconds });
    const lease = this.leases.get(key);
    if (
      !this.slots.has(key) ||
      (lease !== undefined &&
        lease.holder !== holder &&
        lease.until.getTime() > now.getTime())
    ) {
      return Promise.resolve(false);
    }
    this.leases.set(key, {
      holder,
      until: new Date(now.getTime() + seconds * 1000),
    });
    return Promise.resolve(true);
  }

  releaseLease(key: string, holder: string) {
    this.calls.push({ kind: 'release', holder });
    if (this.leases.get(key)?.holder === holder) {
      this.leases.delete(key);
    }
    return Promise.resolve();
  }

  advance(key: string, holder: string, change: SlotProgress, at: Date) {
    if (this.leases.get(key)?.holder !== holder) {
      return Promise.reject(new Error('リースを持たない'));
    }
    this.calls.push({ kind: 'advance', change, at });
    this.slots.set(key, { ...this.slot(key), ...change });
    return Promise.resolve();
  }

  missingParticipants() {
    const failure = this.missingFailures.shift();
    return failure === undefined
      ? Promise.resolve(this.missing)
      : Promise.reject(failure);
  }

  markDispatchRequested(key: string, at: Date) {
    this.calls.push({ kind: 'request', at });
    const stored = this.slot(key);
    if (stored.dispatchRequestedAt === null) {
      this.slots.set(key, { ...stored, dispatchRequestedAt: at });
    }
    return Promise.resolve();
  }

  ensure = notUsed;
  listOverdue = notUsed;
  fixParticipants = notUsed;
  listDoneWithPending = notUsed;
}

class FakeCollector implements SlotCollector {
  steps: (SlotCollectStep | Error)[] = [];
  readonly received: StoredSlot[] = [];

  constructor(
    private readonly name: string,
    private readonly calls: Call[],
  ) {}

  step(slot: StoredSlot) {
    this.calls.push({
      kind: 'collect',
      collector: this.name,
      cursor: slot.cursor,
    });
    this.received.push(slot);
    const next = this.steps.shift();
    if (next === undefined) {
      return Promise.reject(new Error('収集の結果を用意していない'));
    }
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  }
}

class FakeDispatcher implements GroupDispatcher {
  steps: (GroupDispatchStep | Error)[] = [];

  constructor(private readonly calls: Call[]) {}

  dispatchNext(slotKey: string, now: Date, limit: number) {
    this.calls.push({ kind: 'dispatch', slotKey, now, limit });
    const next = this.steps.shift() ?? { emails: 0, skipped: 0, more: false };
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  }
}

interface Harness {
  readonly handler: FlushSlotHandler;
  readonly store: FakeSlotStore;
  readonly evening: FakeCollector;
  readonly morning: FakeCollector;
  readonly dispatcher: FakeDispatcher;
  readonly incidents: NotificationIncident[];
  readonly calls: Call[];
  now: Date;
}

function createHarness(now: Date = AFTER_READY): Harness {
  const calls: Call[] = [];
  const incidents: NotificationIncident[] = [];
  const store = new FakeSlotStore(calls);
  const evening = new FakeCollector('evening', calls);
  const morning = new FakeCollector('morning', calls);
  const dispatcher = new FakeDispatcher(calls);
  const harness: Harness = {
    store,
    evening,
    morning,
    dispatcher,
    incidents,
    calls,
    now,
    handler: new FlushSlotHandler(
      store,
      evening,
      morning,
      dispatcher,
      { report: (incident) => incidents.push(incident) },
      { now: () => harness.now },
    ),
  };
  return harness;
}

function flush(harness: Harness, slotKey: string, meta: MessageMeta = META) {
  return harness.handler.handle({ slotKey }, meta);
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

function callKinds(calls: readonly Call[]): readonly Call['kind'][] {
  return calls.map(({ kind }) => kind);
}

const COLLECTED: SlotCollectStep = {
  kind: 'progress',
  cursor: null,
  done: true,
};
const SENT_ALL: GroupDispatchStep = { emails: 2, skipped: 1, more: false };
const SENT_PART: GroupDispatchStep = { emails: 20, skipped: 0, more: true };

let records: LogRecord[] = [];

beforeEach(() => {
  records = [];
  configureSync({
    reset: true,
    sinks: { capture: (record) => records.push(record) },
    loggers: [
      { category: ['event'], sinks: ['capture'], lowestLevel: 'debug' },
      { category: ['logtape', 'meta'], sinks: [], lowestLevel: 'warning' },
    ],
  });
});

afterEach(() => {
  resetSync();
});

describe('FlushSlotHandler.handle', () => {
  test('枠が無ければリースを取らずに完了する', async () => {
    const harness = createHarness();

    expect(await flush(harness, EVENING.key)).toStrictEqual({
      kind: 'done',
    });
    expect(harness.calls).toStrictEqual([]);
  });

  test('別の保持者がリースを持つ間は、段を進めずに30秒のdeferをする', async () => {
    const harness = createHarness();
    harness.store.put(EVENING, { dispatchRequestedAt: AFTER_READY });
    await harness.store.acquireLease(
      EVENING.key,
      OTHER_HOLDER,
      AFTER_READY,
      FLUSH_SLOT_LEASE_SECONDS,
    );
    harness.calls.length = 0;

    expect(await flush(harness, EVENING.key)).toStrictEqual({
      kind: 'defer',
      delaySeconds: FLUSH_SLOT_LEASE_WAIT_SECONDS,
    });
    expect(FLUSH_SLOT_LEASE_WAIT_SECONDS).toBe(30);
    expect(callKinds(harness.calls)).toStrictEqual(['acquire']);
    expect(harness.store.slot(EVENING.key).phase).toBe('waiting');
  });

  test('リースは封筒のIDを保持者として120秒取る', async () => {
    const harness = createHarness();
    harness.store.put(EVENING, { dispatchRequestedAt: AFTER_READY });
    harness.evening.steps = [COLLECTED];

    await flush(harness, EVENING.key);

    expect(harness.calls[0]).toStrictEqual({
      kind: 'acquire',
      holder: META.id,
      seconds: 120,
    });
    expect(FLUSH_SLOT_LEASE_SECONDS).toBe(120);
  });

  describe('夜の枠の待機の段', () => {
    test('送り出しの依頼があれば、期限より前でも直ちに夜の収集へ進む', async () => {
      const harness = createHarness();
      harness.store.put(EVENING, { dispatchRequestedAt: AFTER_READY });
      harness.evening.steps = [COLLECTED];

      expect(await flush(harness, EVENING.key)).toStrictEqual({
        kind: 'defer',
        delaySeconds: 1,
      });
      expect(callKinds(harness.calls)).toStrictEqual([
        'acquire',
        'advance',
        'collect',
        'advance',
      ]);
      expect(harness.calls[2]).toMatchObject({ collector: 'evening' });
      expect(harness.store.slot(EVENING.key).phase).toBe('sending');
      expect(harness.incidents).toStrictEqual([]);
    });

    test('依頼が無く業務時刻23:54:59なら、リースを放して期限までのdeferをする', async () => {
      const harness = createHarness(LAST_SECOND_BEFORE_DEADLINE);
      harness.store.put(EVENING);

      expect(await flush(harness, EVENING.key)).toStrictEqual({
        kind: 'defer',
        delaySeconds: 1,
      });
      expect(callKinds(harness.calls)).toStrictEqual(['acquire', 'release']);
      expect(harness.store.leases.size).toBe(0);
      expect(harness.store.slot(EVENING.key)).toMatchObject({
        phase: 'waiting',
        dispatchRequestedAt: null,
      });
    });

    test('期限までの残りの秒の端数は切り上げる', async () => {
      const harness = createHarness(new Date(BEFORE_DEADLINE.getTime() + 500));
      harness.store.put(EVENING);

      expect(await flush(harness, EVENING.key)).toStrictEqual({
        kind: 'defer',
        delaySeconds: 60,
      });
    });

    test('期限までの残りが遅延の上限を超えるときは、43200秒のdeferをする', async () => {
      const harness = createHarness(
        new Date(EVENING.settleUntil.getTime() - 50_000_000),
      );
      harness.store.put(EVENING);

      expect(await flush(harness, EVENING.key)).toStrictEqual({
        kind: 'defer',
        delaySeconds: 43_200,
      });
    });

    test('依頼が無く業務時刻23:55:00なら、依頼の時刻を記録して収集へ進み、準備の完了が無い前提の名前を報告する', async () => {
      const harness = createHarness(AT_DEADLINE);
      harness.store.put(EVENING, {
        requiredParticipants: [
          'tournament-week.pairing',
          'tournament-year.pairing',
        ],
      });
      harness.store.missing = ['tournament-year.pairing'];
      harness.evening.steps = [COLLECTED];

      expect(await flush(harness, EVENING.key)).toStrictEqual({
        kind: 'defer',
        delaySeconds: 1,
      });
      expect(harness.calls.slice(0, 2)).toStrictEqual([
        { kind: 'acquire', holder: META.id, seconds: 120 },
        { kind: 'request', at: AT_DEADLINE },
      ]);
      expect(harness.store.slot(EVENING.key).dispatchRequestedAt).toEqual(
        AT_DEADLINE,
      );
      expect(harness.evening.received).toHaveLength(1);
      expect(harness.incidents).toStrictEqual([
        {
          kind: 'evening-dispatch-incomplete',
          slotKey: EVENING.key,
          missing: ['tournament-year.pairing'],
        },
      ]);
    });

    test('前提の一覧が未確定のまま期限を過ぎたら、前提が未確定として報告する', async () => {
      const harness = createHarness(AT_DEADLINE);
      harness.store.put(EVENING);
      harness.store.missing = null;
      harness.evening.steps = [COLLECTED];

      await flush(harness, EVENING.key);

      expect(harness.incidents).toStrictEqual([
        {
          kind: 'evening-dispatch-incomplete',
          slotKey: EVENING.key,
          missing: null,
        },
      ]);
    });

    test('前提がそろっているのに依頼が無いまま期限を過ぎたら、報告せずに収集へ進む', async () => {
      const harness = createHarness(AT_DEADLINE);
      harness.store.put(EVENING, { requiredParticipants: [] });
      harness.store.missing = [];
      harness.evening.steps = [COLLECTED];

      await flush(harness, EVENING.key);

      expect(harness.incidents).toStrictEqual([]);
      expect(harness.store.slot(EVENING.key).phase).toBe('sending');
    });

    test('収集が失敗した再試行では、記録した依頼で進むため2回目の報告をしない', async () => {
      const harness = createHarness(AT_DEADLINE);
      harness.store.put(EVENING);
      harness.evening.steps = [new Error('収集の失敗'), COLLECTED];

      expect(await failureOf(flush(harness, EVENING.key))).toMatchObject({
        message: '収集の失敗',
      });
      await flush(harness, EVENING.key);

      expect(harness.incidents).toHaveLength(1);
      expect(harness.store.slot(EVENING.key).phase).toBe('sending');
    });

    test('前提の読み取りが1回失敗した後の再試行で、報告をちょうど1回行う', async () => {
      const harness = createHarness(AT_DEADLINE);
      harness.store.put(EVENING, {
        requiredParticipants: ['tournament-week.pairing'],
      });
      harness.store.missing = ['tournament-week.pairing'];
      harness.store.missingFailures = [new Error('前提の読み取りの失敗')];
      harness.evening.steps = [COLLECTED];

      expect(await failureOf(flush(harness, EVENING.key))).toMatchObject({
        message: '前提の読み取りの失敗',
      });
      expect(harness.incidents).toStrictEqual([]);
      await flush(harness, EVENING.key);

      expect(harness.incidents).toStrictEqual([
        {
          kind: 'evening-dispatch-incomplete',
          slotKey: EVENING.key,
          missing: ['tournament-week.pairing'],
        },
      ]);
      expect(harness.store.slot(EVENING.key).phase).toBe('sending');
    });
  });

  describe('収集の段', () => {
    test('朝の枠は依頼済みのため直ちに朝の収集へ進み、続きがあればカーソルを保存して1秒のdeferをする', async () => {
      const harness = createHarness();
      harness.store.put(MORNING);
      harness.morning.steps = [
        { kind: 'progress', cursor: '{"ownerIndex":0}', done: false },
      ];

      expect(await flush(harness, MORNING.key)).toStrictEqual({
        kind: 'defer',
        delaySeconds: 1,
      });
      expect(harness.calls[2]).toMatchObject({ collector: 'morning' });
      expect(harness.store.slot(MORNING.key)).toMatchObject({
        phase: 'collecting',
        cursor: '{"ownerIndex":0}',
      });
      expect(harness.store.leases.get(MORNING.key)?.holder).toBe(META.id);
    });

    test('続きの段は保存したカーソルの枠を収集に渡し、完了したら送信の段へ進む', async () => {
      const harness = createHarness();
      harness.store.put(MORNING, {
        phase: 'collecting',
        cursor: '{"ownerIndex":3}',
      });
      harness.morning.steps = [
        { kind: 'progress', cursor: '{"ownerIndex":9}', done: true },
      ];

      expect(await flush(harness, MORNING.key)).toStrictEqual({
        kind: 'defer',
        delaySeconds: 1,
      });
      expect(harness.morning.received[0]?.cursor).toBe('{"ownerIndex":3}');
      expect(harness.store.slot(MORNING.key)).toMatchObject({
        phase: 'sending',
        cursor: null,
      });
      expect(harness.calls.some(({ kind }) => kind === 'dispatch')).toBe(false);
    });

    test('収集が待ちを返したら、段とカーソルを変えずにリースを放して待ちの秒数のdeferをする', async () => {
      const harness = createHarness();
      harness.store.put(MORNING, {
        phase: 'collecting',
        cursor: '{"ownerIndex":3}',
      });
      harness.morning.steps = [
        { kind: 'wait', delaySeconds: 300, pendingKickoffs: 2 },
      ];

      expect(await flush(harness, MORNING.key)).toStrictEqual({
        kind: 'defer',
        delaySeconds: 300,
      });
      expect(callKinds(harness.calls)).toStrictEqual([
        'acquire',
        'collect',
        'release',
      ]);
      expect(harness.store.slot(MORNING.key)).toMatchObject({
        phase: 'collecting',
        cursor: '{"ownerIndex":3}',
      });
      expect(harness.store.leases.size).toBe(0);
    });

    test('受賞の枠は収集を飛ばして送信の段へ進み、同じ処理の中で送る', async () => {
      const harness = createHarness();
      harness.store.put(AWARD);
      harness.dispatcher.steps = [SENT_ALL];

      expect(await flush(harness, AWARD.key)).toStrictEqual({
        kind: 'done',
      });
      expect(callKinds(harness.calls)).toStrictEqual([
        'acquire',
        'advance',
        'dispatch',
        'advance',
        'release',
      ]);
      expect(harness.calls[1]).toMatchObject({
        change: { phase: 'sending', cursor: null },
      });
      expect(harness.evening.received).toHaveLength(0);
      expect(harness.morning.received).toHaveLength(0);
      expect(harness.store.slot(AWARD.key).phase).toBe('done');
    });
  });

  describe('送信の段', () => {
    test('処理の時点の時刻で20件のまとめを送り、続きがあれば段を変えずに1秒のdeferをする', async () => {
      const harness = createHarness();
      harness.store.put(EVENING, {
        phase: 'sending',
        dispatchRequestedAt: AFTER_READY,
      });
      harness.dispatcher.steps = [SENT_PART];

      expect(await flush(harness, EVENING.key)).toStrictEqual({
        kind: 'defer',
        delaySeconds: 1,
      });
      expect(harness.calls).toStrictEqual([
        { kind: 'acquire', holder: META.id, seconds: 120 },
        {
          kind: 'dispatch',
          slotKey: EVENING.key,
          now: AFTER_READY,
          limit: 20,
        },
      ]);
      expect(FLUSH_SLOT_DISPATCH_LIMIT).toBe(20);
      expect(harness.store.slot(EVENING.key).phase).toBe('sending');
      expect(harness.store.leases.get(EVENING.key)?.holder).toBe(META.id);
    });

    test('残りが無ければ完了の段へ進めてリースを放す', async () => {
      const harness = createHarness();
      harness.store.put(EVENING, {
        phase: 'sending',
        dispatchRequestedAt: AFTER_READY,
      });
      harness.dispatcher.steps = [SENT_ALL];

      expect(await flush(harness, EVENING.key)).toStrictEqual({
        kind: 'done',
      });
      expect(callKinds(harness.calls)).toStrictEqual([
        'acquire',
        'dispatch',
        'advance',
        'release',
      ]);
      expect(harness.store.slot(EVENING.key).phase).toBe('done');
      expect(harness.store.leases.size).toBe(0);
    });

    test('収集から送信までを続きのdeferでつなぎ、同じ封筒の再配信で完了まで進む', async () => {
      const harness = createHarness();
      harness.store.put(EVENING, { dispatchRequestedAt: AFTER_READY });
      harness.evening.steps = [COLLECTED];
      harness.dispatcher.steps = [SENT_PART, SENT_ALL];

      const results = [];
      for (let index = 0; index < 3; index += 1) {
        results.push(await flush(harness, EVENING.key));
      }

      expect(results).toStrictEqual([
        { kind: 'defer', delaySeconds: 1 },
        { kind: 'defer', delaySeconds: 1 },
        { kind: 'done' },
      ]);
      expect(
        harness.calls
          .filter((call) => call.kind === 'advance')
          .map((call) => call.change.phase),
      ).toStrictEqual(['collecting', 'sending', 'done']);
    });

    test('完了の枠に遅れた通知があれば送信の段を行い、続きがあれば送信の段へ戻す', async () => {
      const harness = createHarness();
      harness.store.put(EVENING, {
        phase: 'done',
        dispatchRequestedAt: AFTER_READY,
      });
      harness.dispatcher.steps = [SENT_PART, SENT_ALL];

      expect(await flush(harness, EVENING.key)).toStrictEqual({
        kind: 'defer',
        delaySeconds: 1,
      });
      expect(harness.store.slot(EVENING.key).phase).toBe('sending');
      expect(await flush(harness, EVENING.key)).toStrictEqual({
        kind: 'done',
      });
      expect(harness.store.slot(EVENING.key).phase).toBe('done');
      expect(
        harness.calls.filter(({ kind }) => kind === 'dispatch'),
      ).toHaveLength(2);
      expect(harness.evening.received).toHaveLength(0);
    });

    test('完了の枠に遅れた通知が無ければ、段を書き換えずにリースを放して完了する', async () => {
      const harness = createHarness();
      harness.store.put(EVENING, {
        phase: 'done',
        dispatchRequestedAt: AFTER_READY,
      });

      expect(await flush(harness, EVENING.key)).toStrictEqual({
        kind: 'done',
      });
      expect(callKinds(harness.calls)).toStrictEqual([
        'acquire',
        'dispatch',
        'release',
      ]);
    });
  });

  describe('失敗と再開', () => {
    test('収集の例外はそのまま投げ、段とカーソルを残して再試行で同じカーソルから再開する', async () => {
      const harness = createHarness();
      harness.store.put(MORNING, {
        phase: 'collecting',
        cursor: '{"ownerIndex":3}',
      });
      const failure = new Error('フォロワーの照会の失敗');
      harness.morning.steps = [
        failure,
        { kind: 'progress', cursor: '{"ownerIndex":4}', done: false },
      ];

      expect(await failureOf(flush(harness, MORNING.key))).toBe(failure);
      expect(harness.store.slot(MORNING.key)).toMatchObject({
        phase: 'collecting',
        cursor: '{"ownerIndex":3}',
      });

      const retried = { ...META, attempts: 2 };
      expect(await flush(harness, MORNING.key, retried)).toStrictEqual({
        kind: 'defer',
        delaySeconds: 1,
      });
      expect(
        harness.morning.received.map(({ cursor }) => cursor),
      ).toStrictEqual(['{"ownerIndex":3}', '{"ownerIndex":3}']);
      expect(harness.store.slot(MORNING.key).cursor).toBe('{"ownerIndex":4}');
    });

    test('送信の例外はそのまま投げ、再試行で未送信のまとめの送信をやり直す', async () => {
      const harness = createHarness();
      harness.store.put(EVENING, {
        phase: 'sending',
        dispatchRequestedAt: AFTER_READY,
      });
      const failure = new Error('通知の確定の失敗');
      harness.dispatcher.steps = [failure, SENT_ALL];

      expect(await failureOf(flush(harness, EVENING.key))).toBe(failure);
      expect(harness.store.slot(EVENING.key).phase).toBe('sending');

      expect(
        await flush(harness, EVENING.key, { ...META, attempts: 2 }),
      ).toStrictEqual({ kind: 'done' });
      expect(
        harness.calls.filter(({ kind }) => kind === 'dispatch'),
      ).toHaveLength(2);
      expect(harness.store.slot(EVENING.key).phase).toBe('done');
    });

    test('段の記録の例外もそのまま投げる', async () => {
      const harness = createHarness();
      harness.store.put(EVENING, {
        phase: 'sending',
        dispatchRequestedAt: AFTER_READY,
      });
      const failure = new Error('段の記録の失敗');
      harness.store.advance = () => Promise.reject(failure);

      expect(await failureOf(flush(harness, EVENING.key))).toBe(failure);
    });
  });

  test('ログは送り出しの分類で、枠のキー・段・件数だけを属性に持つ', async () => {
    const harness = createHarness();
    harness.store.put(EVENING, {
      phase: 'sending',
      dispatchRequestedAt: AFTER_READY,
    });
    harness.dispatcher.steps = [SENT_ALL];

    await flush(harness, EVENING.key);

    const flushRecords = records.filter(
      ({ category }) => category.join('.') === 'event.notifications.flush',
    );
    expect(flushRecords.length).toBeGreaterThan(0);
    for (const record of flushRecords) {
      expect(Object.keys(record.properties)).toContain('slot');
      expect(Object.keys(record.properties)).toContain('phase');
      for (const name of Object.keys(record.properties)) {
        expect([
          'slot',
          'phase',
          'emails',
          'skipped',
          'delaySeconds',
          'pendingKickoffs',
        ]).toContain(name);
      }
    }
    expect(flushRecords.at(-1)?.properties).toStrictEqual({
      slot: EVENING.key,
      phase: 'done',
      emails: 2,
      skipped: 1,
    });
  });
});
