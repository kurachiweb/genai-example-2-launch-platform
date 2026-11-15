import { beforeEach, describe, expect, test } from 'vitest';

import {
  groupKeyFor,
  type NoticeDraft,
  noticeDedupeKey,
} from '../../core/notifications/notice-plan.ts';
import {
  awardSlot,
  eveningSlot,
  morningSlot,
} from '../../core/notifications/notification-slots.ts';
import { parseBusinessDate } from '../../core/time/business-time.ts';
import {
  createRecordingDatabase,
  createSequentialIds,
  expectSplitWithinBindLimit,
} from '../identity/testing/identity-store-fixtures.ts';
import { D1NotificationNoticeStore } from './d1-notification-notice-store.ts';
import { D1NotificationSlotStore } from './d1-notification-slot-store.ts';
import {
  after,
  clearNotificationTables,
  db,
  insertRecipient,
  readNoticeRows,
  readSlotRow,
  recipientIdOf,
  T0,
} from './testing/notification-store-fixtures.ts';

const DATE = parseBusinessDate('2026-11-01');
const EVENING = eveningSlot(DATE);
const NEXT_EVENING = eveningSlot(parseBusinessDate('2026-11-02'));
const MORNING = morningSlot(parseBusinessDate('2026-11-02'));
const AWARD_EVENT_ID = '01JC0AWARD0000000000000001';
const LEASE_SECONDS = 120;
const BULK_COUNT = 14;

const slots = new D1NotificationSlotStore(db, createSequentialIds(1));

function createStore(database = db): D1NotificationNoticeStore {
  return new D1NotificationNoticeStore(
    database,
    createSequentialIds(5000),
    new D1NotificationSlotStore(database, createSequentialIds(9000)),
  );
}

function matchIdOf(index: number): string {
  return `01JC0MATCH${String(index).padStart(16, '0')}`;
}

function entryIdOf(index: number): string {
  return `01JC0ENTRY${String(index).padStart(16, '0')}`;
}

function productIdOf(index: number): string {
  return `01JC0PRDCT${String(index).padStart(16, '0')}`;
}

function resultDraft(
  recipient: number,
  match: number,
  overrides: Partial<NoticeDraft> = {},
): NoticeDraft {
  return {
    topic: 'match_result',
    recipientUserId: recipientIdOf(recipient),
    slot: EVENING,
    matchId: matchIdOf(match),
    entryId: entryIdOf(match),
    productId: productIdOf(match),
    eventId: null,
    ...overrides,
  };
}

function followedDraft(recipient: number, match: number): NoticeDraft {
  return {
    topic: 'followed_user_match',
    recipientUserId: recipientIdOf(recipient),
    slot: MORNING,
    matchId: matchIdOf(match),
    entryId: entryIdOf(match),
    productId: productIdOf(match),
    eventId: null,
  };
}

async function moveSlotTo(
  key: string,
  phase: 'collecting' | 'sending' | 'done',
): Promise<void> {
  await slots.acquireLease(key, 'test', T0, LEASE_SECONDS);
  await slots.advance(key, 'test', { phase, cursor: null }, T0);
  await slots.releaseLease(key, 'test');
}

beforeEach(async () => {
  await clearNotificationTables();
  await insertRecipient(1);
  await insertRecipient(2);
  await insertRecipient(3);
});

describe('record', () => {
  test('枠を作り、通知を重複のキー・まとめのキー・未送信の状態で記録する', async () => {
    const store = createStore();
    const drafts = [resultDraft(1, 1), resultDraft(2, 2)];

    const result = await store.record(drafts, T0);

    expect(result).toEqual({ created: 2, lateSlotKeys: [] });
    expect(await readSlotRow(EVENING.key)).toMatchObject({
      phase: 'waiting',
      createdAt: T0,
    });
    const rows = await readNoticeRows();
    expect(rows).toEqual(
      drafts.map((draft) => ({
        id: expect.any(String) as string,
        dedupeKey: noticeDedupeKey(draft),
        slotKey: EVENING.key,
        groupKey: groupKeyFor(draft),
        topic: 'match_result',
        recipientUserId: draft.recipientUserId,
        matchId: draft.matchId,
        entryId: draft.entryId,
        productId: draft.productId,
        eventId: null,
        status: 'pending',
        skipReason: null,
        emailRequestId: null,
        settledAt: null,
        createdAt: T0,
        updatedAt: T0,
      })),
    );
  });

  test('同じ重複のキーの通知は記録し直さず、作った件数に数えない', async () => {
    const store = createStore();
    await store.record([resultDraft(1, 1)], T0);

    const result = await store.record(
      [resultDraft(1, 1), resultDraft(1, 1), resultDraft(2, 1)],
      after(1000),
    );

    expect(result.created).toBe(1);
    const rows = await readNoticeRows();
    expect(rows.map((row) => row.recipientUserId)).toEqual([
      recipientIdOf(1),
      recipientIdOf(2),
    ]);
    expect(rows[0]).toMatchObject({ createdAt: T0 });
  });

  test('送り出し中か完了した枠だけを遅れた枠として返す', async () => {
    const store = createStore();
    const award = awardSlot(AWARD_EVENT_ID, T0);
    await slots.ensure(EVENING, T0);
    await slots.ensure(NEXT_EVENING, T0);
    await slots.ensure(MORNING, T0);
    await moveSlotTo(EVENING.key, 'sending');
    await moveSlotTo(NEXT_EVENING.key, 'collecting');
    await moveSlotTo(MORNING.key, 'done');

    const result = await store.record(
      [
        resultDraft(1, 1),
        resultDraft(1, 2, { topic: 'match_preview', slot: NEXT_EVENING }),
        followedDraft(1, 3),
        {
          topic: 'followed_user_award',
          recipientUserId: recipientIdOf(2),
          slot: award,
          matchId: null,
          entryId: null,
          productId: productIdOf(4),
          eventId: AWARD_EVENT_ID,
        },
      ],
      after(1000),
    );

    expect(result.created).toBe(4);
    expect([...result.lateSlotKeys].sort()).toEqual(
      [EVENING.key, MORNING.key].sort(),
    );
    expect(await readSlotRow(award.key)).toMatchObject({ phase: 'waiting' });
  });

  test('重複で作らなかった通知の枠も、送り出し中なら遅れた枠として返す', async () => {
    const store = createStore();
    await store.record([resultDraft(1, 1)], T0);
    await moveSlotTo(EVENING.key, 'done');

    await expect(
      store.record([resultDraft(1, 1)], after(1000)),
    ).resolves.toEqual({ created: 0, lateSlotKeys: [EVENING.key] });
  });

  test('空の下書きは枠も通知も作らない', async () => {
    const recording = createRecordingDatabase();

    await expect(
      createStore(recording.database).record([], T0),
    ).resolves.toEqual({ created: 0, lateSlotKeys: [] });
    expect(recording.placeholderCounts).toEqual([]);
  });

  test('多数の通知を1文のバインド変数が上限に収まる行数ずつ分けて記録する', async () => {
    const recording = createRecordingDatabase();
    const drafts = Array.from({ length: BULK_COUNT }, (_, index) =>
      resultDraft(1, index + 1),
    );

    const result = await createStore(recording.database).record(drafts, T0);

    expect(result.created).toBe(BULK_COUNT);
    expect(await readNoticeRows()).toHaveLength(BULK_COUNT);
    expectSplitWithinBindLimit(recording.placeholderCounts);
  });
});

describe('nextPendingGroups', () => {
  test('未送信の通知を持つまとめのキーを昇順にlimit件読み、各キーの未送信の通知を作成の順に返す', async () => {
    const store = createStore();
    await store.record(
      [followedDraft(2, 3), followedDraft(1, 9), followedDraft(1, 2)],
      T0,
    );
    await store.record([followedDraft(3, 1), followedDraft(1, 5)], after(1));
    const [settled] = await readNoticeRows();
    await store.settle(
      [
        {
          noticeId: settled?.id ?? '',
          status: 'sent',
          reason: null,
          emailRequestId: 'email-1',
        },
      ],
      after(2),
    );

    const groups = await store.nextPendingGroups(MORNING.key, 2);

    expect(groups.map((group) => group.groupKey)).toEqual([
      `${MORNING.key}:${recipientIdOf(1)}`,
      `${MORNING.key}:${recipientIdOf(3)}`,
    ]);
    expect(groups[0]?.notices.map((notice) => notice.matchId)).toEqual([
      matchIdOf(9),
      matchIdOf(2),
      matchIdOf(5),
    ]);
    expect(groups[1]?.notices).toEqual([
      {
        noticeId: expect.any(String) as string,
        ...followedDraft(3, 1),
      },
    ]);
  });

  test('他の枠の通知を含めず、未送信の通知が無ければ空を返す', async () => {
    const store = createStore();
    await store.record([resultDraft(1, 1)], T0);

    await expect(store.nextPendingGroups(MORNING.key, 20)).resolves.toEqual([]);
    const groups = await store.nextPendingGroups(EVENING.key, 20);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.notices[0]?.slot).toEqual(EVENING);
  });
});

describe('settle', () => {
  test('未送信の通知だけを送信済み・送らないに確定し、確定済みの通知は変えない', async () => {
    const store = createStore();
    await store.record(
      [resultDraft(1, 1), resultDraft(2, 2), resultDraft(3, 3)],
      T0,
    );
    const [first, second, third] = await readNoticeRows();
    const firstId = first?.id ?? '';
    await store.settle(
      [
        {
          noticeId: firstId,
          status: 'sent',
          reason: null,
          emailRequestId: 'email-1',
        },
      ],
      after(1000),
    );

    await store.settle(
      [
        {
          noticeId: firstId,
          status: 'skipped',
          reason: 'suppressed',
          emailRequestId: null,
        },
        {
          noticeId: second?.id ?? '',
          status: 'skipped',
          reason: 'topic_disabled',
          emailRequestId: null,
        },
        {
          noticeId: third?.id ?? '',
          status: 'sent',
          reason: null,
          emailRequestId: 'email-2',
        },
      ],
      after(2000),
    );

    const rows = await readNoticeRows();
    expect(
      rows.map(
        ({ status, skipReason, emailRequestId, settledAt, updatedAt }) => ({
          status,
          skipReason,
          emailRequestId,
          settledAt,
          updatedAt,
        }),
      ),
    ).toEqual([
      {
        status: 'sent',
        skipReason: null,
        emailRequestId: 'email-1',
        settledAt: after(1000),
        updatedAt: after(1000),
      },
      {
        status: 'skipped',
        skipReason: 'topic_disabled',
        emailRequestId: null,
        settledAt: after(2000),
        updatedAt: after(2000),
      },
      {
        status: 'sent',
        skipReason: null,
        emailRequestId: 'email-2',
        settledAt: after(2000),
        updatedAt: after(2000),
      },
    ]);
  });

  test('空の確定は問い合わせない', async () => {
    const recording = createRecordingDatabase();

    await createStore(recording.database).settle([], T0);

    expect(recording.placeholderCounts).toEqual([]);
  });
});

describe('deleteByRecipient', () => {
  test('宛先の通知をlimit件まで消して消した件数を返し、他の宛先の通知は残す', async () => {
    const store = createStore();
    await store.record(
      [
        resultDraft(1, 1),
        resultDraft(1, 2),
        resultDraft(1, 3),
        resultDraft(2, 1),
      ],
      T0,
    );

    await expect(store.deleteByRecipient(recipientIdOf(1), 2)).resolves.toBe(2);
    await expect(store.deleteByRecipient(recipientIdOf(1), 2)).resolves.toBe(1);
    await expect(store.deleteByRecipient(recipientIdOf(1), 2)).resolves.toBe(0);

    const rows = await readNoticeRows();
    expect(rows.map((row) => row.recipientUserId)).toEqual([recipientIdOf(2)]);
  });
});
