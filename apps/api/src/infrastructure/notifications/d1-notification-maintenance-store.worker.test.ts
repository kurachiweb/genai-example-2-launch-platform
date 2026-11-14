import { beforeEach, describe, expect, test } from 'vitest';

import {
  createRecordingDatabase,
  expectSplitWithinBindLimit,
} from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import {
  clearNotificationTables,
  db,
  insertRecipient,
  T0,
} from '../../../lib/workers/notifications/testing/notification-store-fixtures.ts';
import { D1NotificationMaintenanceStore } from './d1-notification-maintenance-store.ts';
import {
  at,
  insertEvent,
  insertEvents,
  insertNotice,
  insertReadyMark,
  insertSlot,
  maintenanceEventIdOf,
  maintenanceNoticeIdOf,
  readEventIds,
  readEventStates,
  readNoticeIds,
  readNoticeStates,
  readReadyMarkSlotKeys,
  readSlotKeys,
  RECIPIENT,
} from './testing/maintenance-fixtures.ts';

const NOW = at('2026-12-01T12:21:00.000Z');
const CUTOFF = at('2026-11-01T12:21:00.000Z');
const BEFORE_CUTOFF = at('2026-11-01T12:20:59.999Z');

const store = new D1NotificationMaintenanceStore(db);

beforeEach(async () => {
  await clearNotificationTables();
  await insertRecipient(RECIPIENT);
});

describe('D1NotificationMaintenanceStore', () => {
  describe('expirePending', () => {
    const DUE_BEFORE = at('2026-11-17T12:21:00.000Z');

    beforeEach(async () => {
      await insertSlot('evening:2026-11-15', {
        dueAt: at('2026-11-16T07:45:00.000Z'),
        phase: 'done',
      });
      await insertSlot('morning:2026-11-17', {
        dueAt: DUE_BEFORE,
      });
      await insertNotice(1, 'evening:2026-11-15', { status: 'pending' });
      await insertNotice(2, 'evening:2026-11-15', { status: 'pending' });
      await insertNotice(3, 'evening:2026-11-15', {
        status: 'sent',
        emailRequestId: 'email-request-3',
        settledAt: T0,
      });
      await insertNotice(4, 'evening:2026-11-15', {
        status: 'skipped',
        skipReason: 'topic_disabled',
        settledAt: T0,
      });
      await insertNotice(5, 'morning:2026-11-17', { status: 'pending' });
    });

    test('期日が基準より前の枠の未送信の通知だけを期限切れの理由で送らない扱いにし、件数を返す', async () => {
      await expect(store.expirePending(DUE_BEFORE, NOW)).resolves.toBe(2);

      await expect(readNoticeStates()).resolves.toEqual([
        {
          id: maintenanceNoticeIdOf(1),
          status: 'skipped',
          skipReason: 'expired',
          settledAt: NOW,
          updatedAt: NOW,
        },
        {
          id: maintenanceNoticeIdOf(2),
          status: 'skipped',
          skipReason: 'expired',
          settledAt: NOW,
          updatedAt: NOW,
        },
        {
          id: maintenanceNoticeIdOf(3),
          status: 'sent',
          skipReason: null,
          settledAt: T0,
          updatedAt: T0,
        },
        {
          id: maintenanceNoticeIdOf(4),
          status: 'skipped',
          skipReason: 'topic_disabled',
          settledAt: T0,
          updatedAt: T0,
        },
        {
          id: maintenanceNoticeIdOf(5),
          status: 'pending',
          skipReason: null,
          settledAt: null,
          updatedAt: T0,
        },
      ]);
    });

    test('2回目の呼び出しは何も変えずに0件を返す', async () => {
      await store.expirePending(DUE_BEFORE, NOW);
      const once = await readNoticeStates();

      await expect(
        store.expirePending(DUE_BEFORE, at('2026-12-01T13:00:00.000Z')),
      ).resolves.toBe(0);
      await expect(readNoticeStates()).resolves.toEqual(once);
    });
  });

  describe('listStalePendingEvents', () => {
    const DISPATCHED_BEFORE = at('2026-11-20T12:11:00.000Z');

    beforeEach(async () => {
      await insertEvent(1, {
        lastDispatchedAt: at('2026-11-20T12:00:00.000Z'),
        dispatchCount: 2,
      });
      await insertEvent(2, {
        lastDispatchedAt: at('2026-11-19T12:00:00.000Z'),
      });
      await insertEvent(3, { lastDispatchedAt: DISPATCHED_BEFORE });
      await insertEvent(4, {
        status: 'expanded',
        expandedAt: T0,
        lastDispatchedAt: T0,
      });
      await insertEvent(5, {
        lastDispatchedAt: at('2026-11-20T12:10:59.999Z'),
        dispatchCount: 3,
      });
    });

    test('最後の依頼が基準より前の未展開の通知イベントを、依頼の古い順に依頼の回数とともに返す', async () => {
      await expect(
        store.listStalePendingEvents(DISPATCHED_BEFORE, 100),
      ).resolves.toEqual([
        { eventId: maintenanceEventIdOf(2), dispatchCount: 1 },
        { eventId: maintenanceEventIdOf(1), dispatchCount: 2 },
        { eventId: maintenanceEventIdOf(5), dispatchCount: 3 },
      ]);
    });

    test('件数の上限までを返す', async () => {
      await expect(
        store.listStalePendingEvents(DISPATCHED_BEFORE, 2),
      ).resolves.toEqual([
        { eventId: maintenanceEventIdOf(2), dispatchCount: 1 },
        { eventId: maintenanceEventIdOf(1), dispatchCount: 2 },
      ]);
    });
  });

  describe('markEventsRedispatched', () => {
    test('指定した未展開の通知イベントだけ依頼の回数を1つ進め、最後の依頼の日時を更新する', async () => {
      await insertEvent(1, { dispatchCount: 2 });
      await insertEvent(2);
      await insertEvent(3, { status: 'expanded', expandedAt: T0 });

      await store.markEventsRedispatched(
        [maintenanceEventIdOf(1), maintenanceEventIdOf(3)],
        NOW,
      );

      await expect(readEventStates()).resolves.toEqual([
        {
          id: maintenanceEventIdOf(1),
          status: 'pending',
          dispatchCount: 3,
          lastDispatchedAt: NOW,
          updatedAt: NOW,
        },
        {
          id: maintenanceEventIdOf(2),
          status: 'pending',
          dispatchCount: 1,
          lastDispatchedAt: T0,
          updatedAt: T0,
        },
        {
          id: maintenanceEventIdOf(3),
          status: 'expanded',
          dispatchCount: 1,
          lastDispatchedAt: T0,
          updatedAt: T0,
        },
      ]);
    });

    test('同じIDを重ねて渡しても1つだけ進める', async () => {
      await insertEvent(1);

      await store.markEventsRedispatched(
        [maintenanceEventIdOf(1), maintenanceEventIdOf(1)],
        NOW,
      );

      await expect(readEventStates()).resolves.toMatchObject([
        { id: maintenanceEventIdOf(1), dispatchCount: 2 },
      ]);
    });

    test('バインド変数の上限を超えるIDの一覧を分割して全て進める', async () => {
      const indexes = Array.from({ length: 95 }, (_, index) => index + 1);
      await insertEvents(indexes);
      const recording = createRecordingDatabase();

      await new D1NotificationMaintenanceStore(
        recording.database,
      ).markEventsRedispatched(indexes.map(maintenanceEventIdOf), NOW);

      expectSplitWithinBindLimit(recording.placeholderCounts);
      const states = await readEventStates();
      expect(states).toHaveLength(95);
      expect(states.every((state) => state.dispatchCount === 2)).toBe(true);
      expect(
        states.every((state) => state.lastDispatchedAt.getTime() === +NOW),
      ).toBe(true);
    });

    test('空の一覧では問い合わせをしない', async () => {
      const recording = createRecordingDatabase();

      await new D1NotificationMaintenanceStore(
        recording.database,
      ).markEventsRedispatched([], NOW);

      expect(recording.placeholderCounts).toEqual([]);
    });
  });

  describe('deleteSettledBefore', () => {
    beforeEach(async () => {
      await insertNotice(1, 'evening:2026-10-01', {
        status: 'sent',
        emailRequestId: 'email-request-1',
        settledAt: at('2026-10-02T00:00:00.000Z'),
      });
      await insertNotice(2, 'evening:2026-10-01', {
        status: 'skipped',
        skipReason: 'expired',
        settledAt: at('2026-10-01T00:00:00.000Z'),
      });
      await insertNotice(3, 'evening:2026-10-01', {
        status: 'sent',
        emailRequestId: 'email-request-3',
        settledAt: BEFORE_CUTOFF,
      });
      await insertNotice(4, 'evening:2026-10-01', {
        status: 'sent',
        emailRequestId: 'email-request-4',
        settledAt: CUTOFF,
      });
      await insertNotice(5, 'evening:2026-10-01', { status: 'pending' });
    });

    test('確定が基準より前の通知を確定の古い順に上限まで消し、消した件数を返す', async () => {
      await expect(store.deleteSettledBefore(CUTOFF, 2)).resolves.toBe(2);

      await expect(readNoticeIds()).resolves.toEqual([
        maintenanceNoticeIdOf(3),
        maintenanceNoticeIdOf(4),
        maintenanceNoticeIdOf(5),
      ]);
    });

    test('繰り返すと対象を消し切って0件を返し、未送信の通知と基準ちょうどの通知を残す', async () => {
      await expect(store.deleteSettledBefore(CUTOFF, 2)).resolves.toBe(2);
      await expect(store.deleteSettledBefore(CUTOFF, 2)).resolves.toBe(1);
      await expect(store.deleteSettledBefore(CUTOFF, 2)).resolves.toBe(0);

      await expect(readNoticeIds()).resolves.toEqual([
        maintenanceNoticeIdOf(4),
        maintenanceNoticeIdOf(5),
      ]);
    });
  });

  describe('deleteCompletedSlotsBefore', () => {
    beforeEach(async () => {
      await insertSlot('evening:2026-10-01', {
        phase: 'done',
        completedAt: at('2026-10-02T00:00:00.000Z'),
      });
      await insertSlot('morning:2026-10-01', {
        phase: 'done',
        completedAt: at('2026-10-01T00:00:00.000Z'),
      });
      await insertSlot('evening:2026-10-02', {
        phase: 'done',
        completedAt: BEFORE_CUTOFF,
      });
      await insertSlot('evening:2026-10-03', {
        phase: 'done',
        completedAt: at('2026-10-03T00:00:00.000Z'),
      });
      await insertSlot('evening:2026-10-04', { phase: 'sending' });
      await insertSlot('evening:2026-11-01', {
        phase: 'done',
        completedAt: CUTOFF,
      });
      await insertNotice(1, 'evening:2026-10-03', { status: 'pending' });
      await insertNotice(2, 'evening:2026-10-01', {
        status: 'sent',
        emailRequestId: 'email-request-2',
        settledAt: T0,
      });
      await insertReadyMark('evening:2026-10-01', 'tournament-week');
      await insertReadyMark('evening:2026-10-01', 'tournament-year');
      await insertReadyMark('evening:2026-10-02', 'tournament-week');
      await insertReadyMark('evening:2026-10-03', 'tournament-week');
    });

    test('完了が基準より前で未送信の通知が無い枠を完了の古い順に上限まで消し、その枠の準備の完了の記録も消す', async () => {
      await expect(store.deleteCompletedSlotsBefore(CUTOFF, 2)).resolves.toBe(
        2,
      );

      await expect(readSlotKeys()).resolves.toEqual([
        'evening:2026-10-02',
        'evening:2026-10-03',
        'evening:2026-10-04',
        'evening:2026-11-01',
      ]);
      await expect(readReadyMarkSlotKeys()).resolves.toEqual([
        'evening:2026-10-02',
        'evening:2026-10-03',
      ]);
    });

    test('繰り返すと対象を消し切って0件を返し、未送信の通知が残る枠・完了していない枠・基準ちょうどの枠と確定済みの通知を残す', async () => {
      await expect(store.deleteCompletedSlotsBefore(CUTOFF, 2)).resolves.toBe(
        2,
      );
      await expect(store.deleteCompletedSlotsBefore(CUTOFF, 2)).resolves.toBe(
        1,
      );
      await expect(store.deleteCompletedSlotsBefore(CUTOFF, 2)).resolves.toBe(
        0,
      );

      await expect(readSlotKeys()).resolves.toEqual([
        'evening:2026-10-03',
        'evening:2026-10-04',
        'evening:2026-11-01',
      ]);
      await expect(readReadyMarkSlotKeys()).resolves.toEqual([
        'evening:2026-10-03',
      ]);
      await expect(readNoticeIds()).resolves.toEqual([
        maintenanceNoticeIdOf(1),
        maintenanceNoticeIdOf(2),
      ]);
    });
  });

  describe('deleteExpandedEventsBefore', () => {
    beforeEach(async () => {
      await insertEvent(1, {
        status: 'expanded',
        expandedAt: at('2026-10-02T00:00:00.000Z'),
      });
      await insertEvent(2, {
        status: 'expanded',
        expandedAt: at('2026-10-01T00:00:00.000Z'),
      });
      await insertEvent(3, { status: 'expanded', expandedAt: BEFORE_CUTOFF });
      await insertEvent(4, { status: 'expanded', expandedAt: CUTOFF });
      await insertEvent(5, { lastDispatchedAt: T0 });
    });

    test('展開が基準より前の通知イベントを展開の古い順に上限まで消し、消した件数を返す', async () => {
      await expect(store.deleteExpandedEventsBefore(CUTOFF, 2)).resolves.toBe(
        2,
      );

      await expect(readEventIds()).resolves.toEqual([
        maintenanceEventIdOf(3),
        maintenanceEventIdOf(4),
        maintenanceEventIdOf(5),
      ]);
    });

    test('繰り返すと対象を消し切って0件を返し、未展開の通知イベントと基準ちょうどの通知イベントを残す', async () => {
      await expect(store.deleteExpandedEventsBefore(CUTOFF, 2)).resolves.toBe(
        2,
      );
      await expect(store.deleteExpandedEventsBefore(CUTOFF, 2)).resolves.toBe(
        1,
      );
      await expect(store.deleteExpandedEventsBefore(CUTOFF, 2)).resolves.toBe(
        0,
      );

      await expect(readEventIds()).resolves.toEqual([
        maintenanceEventIdOf(4),
        maintenanceEventIdOf(5),
      ]);
    });
  });
});
