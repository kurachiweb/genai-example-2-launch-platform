import { beforeEach, describe, expect, test } from 'vitest';

import type {
  ModerationRecordStore,
  NewModerationRecord,
} from '../../core/moderation/ports.ts';
import { D1ModerationRecordStore } from './d1-moderation-record-store.ts';
import type { ModerationRecordStatements } from './moderation-record-statements.ts';
import {
  clearModerationRecords,
  db,
  hoursAfter,
  minutesBefore,
  moderatedProductIdOf,
  moderatedUserIdOf,
  moderationIdOf,
  newRecordOf,
  readModerationIds,
  readModerationRows,
  T0,
} from './testing/moderation-record-fixtures.ts';

const implementation = new D1ModerationRecordStore(db);

const store: ModerationRecordStore = implementation;

const statements: ModerationRecordStatements = implementation;

const THREE_YEARS_MS = 3 * 365 * 24 * 60 * 60 * 1000;

async function seed(records: readonly NewModerationRecord[]): Promise<void> {
  const [first, ...rest] = records.map((record) =>
    statements.insertStatement(record),
  );
  if (first === undefined) {
    return;
  }
  await db.batch([first, ...rest]);
}

beforeEach(clearModerationRecords);

describe('insertStatement', () => {
  test('一括の書き込みで確定するまで記録を書かず、確定すると措置の種類から対象の種類を決めて記録する', async () => {
    const record = newRecordOf(1, {
      action: 'comment.hide',
      targetId: '01JQ0CMT000000000000000001',
      productId: moderatedProductIdOf(1),
      lifecycleEventId: null,
      noticeStatus: 'pending',
    });

    const statement = statements.insertStatement(record);
    expect(await readModerationRows()).toEqual([]);
    await db.batch([statement]);

    expect(await readModerationRows()).toEqual([
      {
        ...record,
        targetKind: 'comment',
        noticeRequestedAt: null,
        createdAt: T0,
        updatedAt: T0,
      },
    ]);
  });

  test('確定した記録をIDで引くと、入力と通知の依頼日時の無い記録を返し、無いIDではundefinedを返す', async () => {
    const record = newRecordOf(1, {
      lifecycleEventId: '01JQ0EVT000000000000000001',
      noticeStatus: 'pending',
    });
    await seed([record]);

    await expect(store.find(record.id)).resolves.toEqual({
      ...record,
      noticeRequestedAt: null,
    });
    await expect(store.find(moderationIdOf(99))).resolves.toBeUndefined();
  });
});

describe('latestFor', () => {
  test('対象ごとに指定した種類の最新の1件の種類・理由・日時を返し、指定した種類の記録が無い対象を含めない', async () => {
    const userA = moderatedUserIdOf(1);
    const userB = moderatedUserIdOf(2);
    const userC = moderatedUserIdOf(3);
    await seed([
      newRecordOf(1, {
        targetId: userA,
        reason: '1回目',
        occurredAt: minutesBefore(30),
      }),
      newRecordOf(2, {
        action: 'user.unsuspend',
        targetId: userA,
        reason: '解除',
        occurredAt: minutesBefore(20),
      }),
      newRecordOf(3, {
        targetId: userA,
        reason: '2回目',
        occurredAt: minutesBefore(10),
      }),
      newRecordOf(4, {
        action: 'user.unsuspend',
        targetId: userA,
        reason: '指定外の最新',
        occurredAt: T0,
      }),
      newRecordOf(5, {
        action: 'user.unsuspend',
        targetId: userB,
        occurredAt: T0,
      }),
      newRecordOf(6, { targetId: userC, reason: null, occurredAt: T0 }),
    ]);

    const latest = await store.latestFor({
      targetIds: [userA, userB, userC, moderatedUserIdOf(9)],
      actions: ['user.suspend'],
    });

    expect(
      [...latest.entries()].toSorted(([a], [b]) => a.localeCompare(b)),
    ).toEqual([
      [
        userA,
        {
          action: 'user.suspend',
          reason: '2回目',
          occurredAt: minutesBefore(10),
        },
      ],
      [userC, { action: 'user.suspend', reason: null, occurredAt: T0 }],
    ]);
  });

  test('複数の種類を指定すると、そのうち最新の1件を返し、同じ日時では後に作った記録を返す', async () => {
    const product = moderatedProductIdOf(1);
    await seed([
      newRecordOf(1, {
        action: 'product.hide',
        targetId: product,
        productId: product,
        reason: '非公開化',
        occurredAt: T0,
      }),
      newRecordOf(2, {
        action: 'product.unhide',
        targetId: product,
        productId: product,
        reason: '復元',
        occurredAt: T0,
      }),
    ]);

    const latest = await store.latestFor({
      targetIds: [product],
      actions: ['product.hide', 'product.unhide'],
    });

    expect(latest.get(product)).toEqual({
      action: 'product.unhide',
      reason: '復元',
      occurredAt: T0,
    });
  });

  test('バインド変数の上限を超える数の対象でも、すべての対象の最新を返す', async () => {
    const indexes = Array.from({ length: 200 }, (_, index) => index + 1);
    const [first, ...rest] = indexes.map((index) =>
      statements.insertStatement(newRecordOf(index)),
    );
    if (first !== undefined) {
      await db.batch([first, ...rest]);
    }

    const latest = await store.latestFor({
      targetIds: indexes.map(moderatedUserIdOf),
      actions: [
        'user.suspend',
        'user.unsuspend',
        'user.administrative-withdraw',
        'product.hide',
        'product.unhide',
        'comment.hide',
        'comment.unhide',
        'rating.invalidate',
        'rating.revalidate',
        'image.approve',
        'image.quarantine',
        'image.release',
        'image.delete',
      ],
    });

    expect(latest.size).toBe(indexes.length);
  });

  test('対象または種類が空なら問い合わせずに空を返す', async () => {
    await seed([newRecordOf(1)]);

    await expect(
      store.latestFor({ targetIds: [], actions: ['user.suspend'] }),
    ).resolves.toEqual(new Map());
    await expect(
      store.latestFor({ targetIds: [moderatedUserIdOf(1)], actions: [] }),
    ).resolves.toEqual(new Map());
  });
});

describe('listPendingNotices', () => {
  test('依頼待ちのうち指定の日時以前に起きた記録を古い順に上限まで返し、他の通知の状態を含めない', async () => {
    const threshold = minutesBefore(60);
    await seed([
      newRecordOf(1, {
        noticeStatus: 'pending',
        occurredAt: minutesBefore(59),
      }),
      newRecordOf(2, {
        noticeStatus: 'pending',
        occurredAt: minutesBefore(60),
      }),
      newRecordOf(3, {
        noticeStatus: 'pending',
        occurredAt: minutesBefore(120),
      }),
      newRecordOf(4, {
        noticeStatus: 'pending',
        occurredAt: minutesBefore(61),
      }),
      newRecordOf(5, {
        noticeStatus: 'requested',
        occurredAt: minutesBefore(180),
      }),
      newRecordOf(6, {
        noticeStatus: 'skipped',
        occurredAt: minutesBefore(180),
      }),
      newRecordOf(7, { noticeStatus: 'none', occurredAt: minutesBefore(180) }),
    ]);

    const all = await store.listPendingNotices({
      occurredBefore: threshold,
      limit: 100,
    });
    const limited = await store.listPendingNotices({
      occurredBefore: threshold,
      limit: 2,
    });

    expect(all.map((record) => record.id)).toEqual(
      [3, 4, 2].map(moderationIdOf),
    );
    expect(all[0]).toEqual({
      ...newRecordOf(3, {
        noticeStatus: 'pending',
        occurredAt: minutesBefore(120),
      }),
      noticeRequestedAt: null,
    });
    expect(limited.map((record) => record.id)).toEqual(
      [3, 4].map(moderationIdOf),
    );
  });
});

describe('markNotice', () => {
  test('依頼待ちを依頼済みに進めて依頼日時を残し、2回目は変えずにfalseを返す', async () => {
    await seed([newRecordOf(1, { noticeStatus: 'pending' })]);
    const at = hoursAfter(1);

    const first = await store.markNotice({
      id: moderationIdOf(1),
      from: 'pending',
      to: 'requested',
      at,
    });
    const second = await store.markNotice({
      id: moderationIdOf(1),
      from: 'pending',
      to: 'skipped',
      at: hoursAfter(2),
    });

    expect([first, second]).toEqual([true, false]);
    expect(await readModerationRows()).toMatchObject([
      { noticeStatus: 'requested', noticeRequestedAt: at, updatedAt: at },
    ]);
  });

  test('依頼待ちを送らなかったに進めると依頼日時を持たず、依頼待ちでない記録と無い記録は変えない', async () => {
    await seed([
      newRecordOf(1, { noticeStatus: 'pending' }),
      newRecordOf(2, { noticeStatus: 'none' }),
    ]);
    const at = hoursAfter(1);

    const results = [
      await store.markNotice({
        id: moderationIdOf(1),
        from: 'pending',
        to: 'skipped',
        at,
      }),
      await store.markNotice({
        id: moderationIdOf(2),
        from: 'pending',
        to: 'requested',
        at,
      }),
      await store.markNotice({
        id: moderationIdOf(99),
        from: 'pending',
        to: 'requested',
        at,
      }),
    ];

    expect(results).toEqual([true, false, false]);
    expect(await readModerationRows()).toMatchObject([
      { noticeStatus: 'skipped', noticeRequestedAt: null, updatedAt: at },
      { noticeStatus: 'none', noticeRequestedAt: null, updatedAt: T0 },
    ]);
  });
});

describe('eraseBySubjectUser', () => {
  test('関わる利用者の記録を上限の件数ずつ消して残りの有無を返し、他の利用者の記録を残す', async () => {
    const subject = moderatedUserIdOf(1);
    await seed([
      newRecordOf(1, { targetId: subject, subjectUserId: subject }),
      newRecordOf(2, {
        action: 'comment.hide',
        targetId: '01JQ0CMT000000000000000002',
        subjectUserId: subject,
        productId: moderatedProductIdOf(1),
      }),
      newRecordOf(3, {
        action: 'image.quarantine',
        targetId: '01JQ0IMG000000000000000003',
        subjectUserId: subject,
      }),
      newRecordOf(4),
    ]);

    const first = await store.eraseBySubjectUser(subject, 2);
    const second = await store.eraseBySubjectUser(subject, 2);
    const third = await store.eraseBySubjectUser(subject, 2);

    expect([first, second, third]).toEqual([
      { remaining: true },
      { remaining: false },
      { remaining: false },
    ]);
    expect(await readModerationIds()).toEqual([moderationIdOf(4)]);
  });
});

describe('eraseByProduct', () => {
  test('関わるプロダクトの記録を上限の件数ずつ消して残りの有無を返し、他のプロダクトの記録を残す', async () => {
    const product = moderatedProductIdOf(1);
    const otherProduct = moderatedProductIdOf(2);
    await seed([
      newRecordOf(1, {
        action: 'product.hide',
        targetId: product,
        productId: product,
      }),
      newRecordOf(2, {
        action: 'rating.invalidate',
        targetId: '01JQ0RTG000000000000000002',
        productId: product,
      }),
      newRecordOf(3, {
        action: 'product.hide',
        targetId: otherProduct,
        productId: otherProduct,
      }),
    ]);

    const first = await store.eraseByProduct(product, 1);
    const second = await store.eraseByProduct(product, 1);

    expect([first, second]).toEqual([
      { remaining: true },
      { remaining: false },
    ]);
    expect(await readModerationIds()).toEqual([moderationIdOf(3)]);
  });
});

describe('eraseOccurredBefore', () => {
  test('指定の日時より前に起きた記録を古い順に上限の件数ずつ消して件数を返し、指定の日時以降の記録を残す', async () => {
    const threshold = new Date(T0.getTime() - THREE_YEARS_MS);
    await seed([
      newRecordOf(1, { occurredAt: new Date(threshold.getTime() - 1) }),
      newRecordOf(2, { occurredAt: new Date(threshold.getTime() - 2) }),
      newRecordOf(3, { occurredAt: threshold }),
      newRecordOf(4, { occurredAt: T0 }),
    ]);

    const first = await store.eraseOccurredBefore(threshold, 1);
    const afterFirst = await readModerationIds();
    const second = await store.eraseOccurredBefore(threshold, 1);
    const third = await store.eraseOccurredBefore(threshold, 1);

    expect([first, second, third]).toEqual([1, 1, 0]);
    expect(afterFirst).toEqual([1, 3, 4].map(moderationIdOf));
    expect(await readModerationIds()).toEqual([3, 4].map(moderationIdOf));
  });
});
