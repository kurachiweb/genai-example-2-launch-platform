import { beforeEach, describe, expect, test } from 'vitest';

import { notificationNotices } from '../../../db/schema/notifications/notification-notices.ts';
import { notificationSlots } from '../../../db/schema/notifications/notification-slots.ts';
import {
  awardSlot,
  eveningSlot,
  morningSlot,
  type NotificationSlot,
} from '../../core/notifications/notification-slots.ts';
import { parseBusinessDate } from '../../core/time/business-time.ts';
import { createSequentialIds } from '../identity/testing/identity-store-fixtures.ts';
import { D1NotificationSlotStore } from './d1-notification-slot-store.ts';
import {
  after,
  clearNotificationTables,
  db,
  insertReadyMarks,
  insertRecipient,
  readSlotRow,
  recipientIdOf,
  T0,
} from './testing/notification-store-fixtures.ts';

const DATE = parseBusinessDate('2026-11-01');
const EVENING = eveningSlot(DATE);
const NEXT_EVENING = eveningSlot(parseBusinessDate('2026-11-02'));
const MORNING = morningSlot(DATE);
const AWARD_EVENT_ID = '01JC0AWARD0000000000000001';
const LEASE_SECONDS = 120;
const MILLISECONDS_PER_SECOND = 1000;

const store = new D1NotificationSlotStore(db, createSequentialIds());

beforeEach(async () => {
  await clearNotificationTables();
});

async function insertSlotRow(
  slot: NotificationSlot,
  columns: Partial<typeof notificationSlots.$inferInsert> = {},
): Promise<void> {
  await db.insert(notificationSlots).values({
    id: crypto.randomUUID(),
    slotKey: slot.key,
    kind: slot.kind,
    dueAt: slot.dueAt,
    settleUntil: slot.settleUntil,
    createdAt: T0,
    updatedAt: T0,
    ...columns,
  });
}

let noticeSequence = 0;

async function insertNoticeRow(
  slotKey: string,
  status: 'pending' | 'sent',
  createdAt: Date,
): Promise<void> {
  noticeSequence += 1;
  await db.insert(notificationNotices).values({
    id: crypto.randomUUID(),
    dedupeKey: `dedupe-${String(noticeSequence)}`,
    slotKey,
    groupKey: `${slotKey}:${recipientIdOf(1)}`,
    topic: 'followed_user_match',
    recipientUserId: recipientIdOf(1),
    status,
    createdAt,
    updatedAt: createdAt,
  });
}

describe('ensure・find', () => {
  test('夜の枠を待機の段・前提と依頼の時刻が未確定の行として作り、読み直した行を返す', async () => {
    const stored = await store.ensure(EVENING, T0);

    expect(stored).toEqual({
      key: EVENING.key,
      kind: 'evening',
      dueAt: EVENING.dueAt,
      settleUntil: EVENING.settleUntil,
      phase: 'waiting',
      cursor: null,
      requiredParticipants: null,
      dispatchRequestedAt: null,
    });
    await expect(store.find(EVENING.key)).resolves.toEqual(stored);
    expect(await readSlotRow(EVENING.key)).toMatchObject({
      createdAt: T0,
      updatedAt: T0,
      leaseHolder: null,
      leaseUntil: null,
      startedAt: null,
      completedAt: null,
    });
  });

  test('同じキーの枠が既にあれば作り直さず、既にある行を返す', async () => {
    await store.ensure(EVENING, T0);
    await store.fixParticipants(EVENING.key, ['tournament-week.pairing'], T0);

    const stored = await store.ensure(EVENING, after(60_000));

    expect(stored.requiredParticipants).toEqual(['tournament-week.pairing']);
    expect(await readSlotRow(EVENING.key)).toMatchObject({ createdAt: T0 });
  });

  test('朝と受賞の枠は作成の時点で送り出しを依頼済みにする', async () => {
    const award = awardSlot(AWARD_EVENT_ID, after(5000));

    await expect(store.ensure(MORNING, T0)).resolves.toMatchObject({
      kind: 'morning',
      dispatchRequestedAt: T0,
    });
    await expect(store.ensure(award, after(5000))).resolves.toMatchObject({
      key: `award:${AWARD_EVENT_ID}`,
      kind: 'award',
      dueAt: after(5000),
      settleUntil: after(5000),
      dispatchRequestedAt: after(5000),
    });
  });

  test('無い枠はundefinedを返す', async () => {
    await expect(store.find(EVENING.key)).resolves.toBeUndefined();
  });
});

describe('acquireLease・releaseLease', () => {
  test('リースの期限の間は別の保持者が取れず、同じ保持者は取り直して期限を延ばせる', async () => {
    await store.ensure(EVENING, T0);

    await expect(
      store.acquireLease(EVENING.key, 'holder-a', T0, LEASE_SECONDS),
    ).resolves.toBe(true);
    await expect(
      store.acquireLease(EVENING.key, 'holder-b', after(1000), LEASE_SECONDS),
    ).resolves.toBe(false);
    await expect(
      store.acquireLease(EVENING.key, 'holder-a', after(1000), LEASE_SECONDS),
    ).resolves.toBe(true);

    expect(await readSlotRow(EVENING.key)).toMatchObject({
      leaseHolder: 'holder-a',
      leaseUntil: after(1000 + LEASE_SECONDS * MILLISECONDS_PER_SECOND),
    });
  });

  test('リースの期限を過ぎると別の保持者が取れる', async () => {
    await store.ensure(EVENING, T0);
    await store.acquireLease(EVENING.key, 'holder-a', T0, LEASE_SECONDS);
    const expiry = after(LEASE_SECONDS * MILLISECONDS_PER_SECOND);

    await expect(
      store.acquireLease(
        EVENING.key,
        'holder-b',
        after(LEASE_SECONDS * MILLISECONDS_PER_SECOND - 1),
        LEASE_SECONDS,
      ),
    ).resolves.toBe(false);
    await expect(
      store.acquireLease(EVENING.key, 'holder-b', expiry, LEASE_SECONDS),
    ).resolves.toBe(true);
    expect(await readSlotRow(EVENING.key)).toMatchObject({
      leaseHolder: 'holder-b',
    });
  });

  test('無い枠のリースは取れない', async () => {
    await expect(
      store.acquireLease(EVENING.key, 'holder-a', T0, LEASE_SECONDS),
    ).resolves.toBe(false);
  });

  test('保持者だけがリースを手放せ、手放した後は別の保持者が直ちに取れる', async () => {
    await store.ensure(EVENING, T0);
    await store.acquireLease(EVENING.key, 'holder-a', T0, LEASE_SECONDS);

    await store.releaseLease(EVENING.key, 'holder-b');
    expect(await readSlotRow(EVENING.key)).toMatchObject({
      leaseHolder: 'holder-a',
    });

    await store.releaseLease(EVENING.key, 'holder-a');
    expect(await readSlotRow(EVENING.key)).toMatchObject({
      leaseHolder: null,
      leaseUntil: null,
    });
    await expect(
      store.acquireLease(EVENING.key, 'holder-b', after(1000), LEASE_SECONDS),
    ).resolves.toBe(true);
  });
});

describe('advance', () => {
  test('リースの保持者は段とカーソルを進め、最初に待機を抜けた日時と完了の日時を記録する', async () => {
    await store.ensure(EVENING, T0);
    await store.acquireLease(EVENING.key, 'holder-a', T0, LEASE_SECONDS);

    await store.advance(
      EVENING.key,
      'holder-a',
      { phase: 'collecting', cursor: '{"offset":10}' },
      after(1000),
    );
    expect(await store.find(EVENING.key)).toMatchObject({
      phase: 'collecting',
      cursor: '{"offset":10}',
    });

    await store.advance(
      EVENING.key,
      'holder-a',
      { phase: 'sending', cursor: null },
      after(2000),
    );
    await store.advance(
      EVENING.key,
      'holder-a',
      { phase: 'done', cursor: null },
      after(3000),
    );
    expect(await readSlotRow(EVENING.key)).toMatchObject({
      phase: 'done',
      cursor: null,
      startedAt: after(1000),
      completedAt: after(3000),
      updatedAt: after(3000),
    });
  });

  test('リースの保持者でなければ段を変えずに例外を投げる', async () => {
    await store.ensure(EVENING, T0);
    await store.acquireLease(EVENING.key, 'holder-a', T0, LEASE_SECONDS);

    await expect(
      store.advance(
        EVENING.key,
        'holder-b',
        { phase: 'collecting', cursor: 'x' },
        after(1000),
      ),
    ).rejects.toThrow(EVENING.key);
    expect(await store.find(EVENING.key)).toMatchObject({
      phase: 'waiting',
      cursor: null,
    });
  });
});

describe('listOverdue', () => {
  test('完了していない枠のうち送り出しの期限がbeforeより前のものを、期限の順にlimit件まで返す', async () => {
    await insertSlotRow(NEXT_EVENING, { phase: 'sending' });
    await insertSlotRow(EVENING, { phase: 'waiting' });
    await insertSlotRow(MORNING, { phase: 'done' });
    await insertSlotRow(eveningSlot(parseBusinessDate('2026-11-03')));
    const before = NEXT_EVENING.settleUntil;
    const exactly = await store.listOverdue(before, 10);
    const later = await store.listOverdue(after(10 * 86_400_000), 2);

    expect(exactly.map((slot) => slot.key)).toEqual([EVENING.key]);
    expect(later.map((slot) => slot.key)).toEqual([
      EVENING.key,
      NEXT_EVENING.key,
    ]);
  });
});

describe('listDoneWithPending', () => {
  test('完了した枠のうち作成がbeforeより前の未送信の通知が残るものだけを返す', async () => {
    await insertRecipient(1);
    const stuck = eveningSlot(parseBusinessDate('2026-10-30'));
    const settled = eveningSlot(parseBusinessDate('2026-10-31'));
    const fresh = NEXT_EVENING;
    await insertSlotRow(stuck, { phase: 'done', completedAt: T0 });
    await insertSlotRow(settled, { phase: 'done', completedAt: T0 });
    await insertSlotRow(fresh, { phase: 'done', completedAt: T0 });
    await insertSlotRow(EVENING, { phase: 'sending' });
    await insertNoticeRow(stuck.key, 'pending', T0);
    await insertNoticeRow(settled.key, 'sent', T0);
    await insertNoticeRow(fresh.key, 'pending', after(60_000));
    await insertNoticeRow(EVENING.key, 'pending', T0);

    const slots = await store.listDoneWithPending(after(60_000), 10);

    expect(slots.map((slot) => slot.key)).toEqual([stuck.key]);
    expect(slots[0]).toMatchObject({ phase: 'done' });
  });

  test('limit件までを返す', async () => {
    await insertRecipient(1);
    const slots = [
      eveningSlot(parseBusinessDate('2026-10-28')),
      eveningSlot(parseBusinessDate('2026-10-29')),
      eveningSlot(parseBusinessDate('2026-10-30')),
    ];
    for (const slot of slots) {
      await insertSlotRow(slot, { phase: 'done', completedAt: T0 });
      await insertNoticeRow(slot.key, 'pending', T0);
      await insertNoticeRow(slot.key, 'pending', T0);
    }

    const found = await store.listDoneWithPending(after(1), 2);

    expect(found.map((slot) => slot.key)).toEqual([
      slots[0]?.key,
      slots[1]?.key,
    ]);
  });
});

describe('fixParticipants・missingParticipants', () => {
  test('前提の一覧が未確定の枠と無い枠は、未完了の名前の代わりにnullを返す', async () => {
    await store.ensure(EVENING, T0);

    await expect(store.missingParticipants(EVENING.key)).resolves.toBeNull();
    await expect(
      store.missingParticipants(NEXT_EVENING.key),
    ).resolves.toBeNull();
  });

  test('前提の一覧は未確定のときだけ書き込み、2回目は書き込まずにfalseを返す', async () => {
    await store.ensure(EVENING, T0);

    await expect(
      store.fixParticipants(
        EVENING.key,
        ['tournament-week.pairing', 'tournament-year.pairing'],
        after(1000),
      ),
    ).resolves.toBe(true);
    await expect(
      store.fixParticipants(EVENING.key, ['other.pairing'], after(2000)),
    ).resolves.toBe(false);

    expect(await readSlotRow(EVENING.key)).toMatchObject({
      requiredParticipants: [
        'tournament-week.pairing',
        'tournament-year.pairing',
      ],
      updatedAt: after(1000),
    });
  });

  test('空の前提の一覧も確定として書き込み、未完了の名前は空になる', async () => {
    await store.ensure(EVENING, T0);

    await expect(store.fixParticipants(EVENING.key, [], T0)).resolves.toBe(
      true,
    );
    await expect(store.fixParticipants(EVENING.key, ['a.b'], T0)).resolves.toBe(
      false,
    );
    await expect(store.missingParticipants(EVENING.key)).resolves.toEqual([]);
  });

  test('前提のうち、その枠に準備の完了が無い名前を前提の一覧の順に返す', async () => {
    await store.ensure(EVENING, T0);
    await store.fixParticipants(
      EVENING.key,
      ['tournament-year.pairing', 'tournament-week.pairing'],
      T0,
    );
    await insertReadyMarks(NEXT_EVENING.key, ['tournament-year.pairing']);

    await expect(store.missingParticipants(EVENING.key)).resolves.toEqual([
      'tournament-year.pairing',
      'tournament-week.pairing',
    ]);

    await insertReadyMarks(EVENING.key, ['tournament-year.pairing']);
    await expect(store.missingParticipants(EVENING.key)).resolves.toEqual([
      'tournament-week.pairing',
    ]);

    await insertReadyMarks(EVENING.key, ['tournament-week.pairing']);
    await expect(store.missingParticipants(EVENING.key)).resolves.toEqual([]);
  });

  test('前提の一覧を持たない枠の行が無い場合はfalseを返す', async () => {
    await expect(store.fixParticipants(EVENING.key, ['a.b'], T0)).resolves.toBe(
      false,
    );
  });
});

describe('markDispatchRequested', () => {
  test('送り出しの依頼の時刻を記録し、既に記録があれば変えない', async () => {
    await store.ensure(EVENING, T0);

    await store.markDispatchRequested(EVENING.key, after(1000));
    await store.markDispatchRequested(EVENING.key, after(2000));

    await expect(store.find(EVENING.key)).resolves.toMatchObject({
      dispatchRequestedAt: after(1000),
    });
    expect(await readSlotRow(EVENING.key)).toMatchObject({
      updatedAt: after(1000),
    });
  });
});
