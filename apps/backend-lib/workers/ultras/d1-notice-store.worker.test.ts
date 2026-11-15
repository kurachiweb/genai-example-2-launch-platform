import { beforeEach, describe, expect, expectTypeOf, test } from 'vitest';

import {
  ULTRAS_NOTICE_KIND_VALUES,
  ULTRAS_NOTICE_STATUS_VALUES,
} from '../../../db/schema/ultras/ultras-notices.ts';
import type {
  UltrasNoticeKind,
  UltrasNoticeStatus,
} from '../../core/ultras/ports.ts';
import {
  createRecordingDatabase,
  expectWithinBindLimit,
} from '../identity/testing/identity-store-fixtures.ts';
import { D1NoticeStore } from './d1-notice-store.ts';
import {
  after,
  clearUltrasTables,
  db,
  insertNoticeRow,
  insertNoticeRows,
  insertUser,
  newNoticeRow,
  noticeIdOf,
  readNoticeIds,
  readNoticeRow,
  stripeSubscriptionIdOf,
  T0,
  userIdOf,
} from './testing/ultras-store-fixtures.ts';

const MINUTE = 60_000;
const DAY = 86_400_000;

const store = new D1NoticeStore(db);

function insertInputOf(
  index: number,
  kind: UltrasNoticeKind = 'payment_failed',
) {
  return {
    id: noticeIdOf(index),
    userId: userIdOf(1),
    stripeSubscriptionId: stripeSubscriptionIdOf(index),
    kind,
    dedupeKey: `${kind}:${stripeSubscriptionIdOf(index)}:${String(T0.getTime())}`,
    payload: {
      acceptedAt: T0.toISOString(),
      benefitEndsAt: after(DAY).toISOString(),
    },
  };
}

function idsOf(rows: readonly { readonly id: string }[]): string[] {
  return rows.map(({ id }) => id);
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, offset) => from + offset);
}

beforeEach(async () => {
  await clearUltrasTables();
  await insertUser(1);
  await insertUser(2);
});

describe('D1NoticeStoreのメールの依頼の行の追加', () => {
  test('追加した依頼を定期課金ごとの依頼待ちとして、種別・重複防止の鍵・内容とともに返す', async () => {
    await db.batch([
      store.insertIfAbsent(insertInputOf(1, 'cancellation_accepted')),
    ]);

    const found = await store.findPendingBySubscription(
      stripeSubscriptionIdOf(1),
    );

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      ...insertInputOf(1, 'cancellation_accepted'),
      status: 'pending',
      finishedAt: null,
    });
    expect(found[0]?.createdAt).toBeInstanceOf(Date);
    expect(
      await store.findPendingBySubscription(stripeSubscriptionIdOf(2)),
    ).toEqual([]);
  });

  test('同じ重複防止の鍵の2つ目の追加は別の一括の書き込みでも無視し、最初の行を保つ', async () => {
    await db.batch([store.insertIfAbsent(insertInputOf(1))]);

    await db.batch([
      store.insertIfAbsent({
        ...insertInputOf(1),
        id: noticeIdOf(2),
        payload: { acceptedAt: after(DAY).toISOString() },
      }),
    ]);

    const found = await store.findPendingBySubscription(
      stripeSubscriptionIdOf(1),
    );
    expect(idsOf(found)).toEqual([noticeIdOf(1)]);
    expect(found[0]?.payload).toEqual(insertInputOf(1).payload);
    expect(await readNoticeRow(noticeIdOf(2))).toBeUndefined();
  });

  test('内容が文字列の対応でない行は読み取りで失敗する', async () => {
    await insertNoticeRow(newNoticeRow(1), { payloadJson: '["a"]' });

    await expect(
      store.findPendingBySubscription(stripeSubscriptionIdOf(1)),
    ).rejects.toThrow(TypeError);
  });
});

describe('D1NoticeStoreの定期課金ごとの依頼待ちの検索', () => {
  test('指定した定期課金の依頼待ちだけを作成の古い順に返し、依頼済み・対象外・他の定期課金の依頼を返さない', async () => {
    await insertNoticeRows([
      newNoticeRow(1, {
        stripeSubscriptionId: stripeSubscriptionIdOf(1),
        createdAt: after(2 * MINUTE),
      }),
      newNoticeRow(2, {
        stripeSubscriptionId: stripeSubscriptionIdOf(1),
        kind: 'cancellation_accepted',
        createdAt: after(MINUTE),
      }),
      newNoticeRow(3, {
        stripeSubscriptionId: stripeSubscriptionIdOf(1),
        status: 'requested',
        finishedAt: after(MINUTE),
      }),
      newNoticeRow(4, {
        stripeSubscriptionId: stripeSubscriptionIdOf(1),
        status: 'skipped',
        finishedAt: after(MINUTE),
      }),
      newNoticeRow(5, {
        stripeSubscriptionId: stripeSubscriptionIdOf(2),
        userId: userIdOf(2),
      }),
    ]);

    expect(
      idsOf(await store.findPendingBySubscription(stripeSubscriptionIdOf(1))),
    ).toEqual([noticeIdOf(2), noticeIdOf(1)]);
    expect(
      idsOf(await store.findPendingBySubscription(stripeSubscriptionIdOf(2))),
    ).toEqual([noticeIdOf(5)]);
  });
});

describe('D1NoticeStoreの依頼待ちのまま残った依頼の検索', () => {
  test('作成から指定の日時以前で依頼待ちの依頼を作成の古い順に上限の件数まで返し、直近の依頼と依頼を終えた依頼を返さない', async () => {
    const threshold = after(10 * MINUTE);
    await insertNoticeRows([
      newNoticeRow(1, { createdAt: threshold }),
      newNoticeRow(2, { createdAt: new Date(threshold.getTime() + 1) }),
      newNoticeRow(3, { createdAt: after(MINUTE) }),
      newNoticeRow(4, {
        createdAt: T0,
        status: 'requested',
        finishedAt: after(MINUTE),
      }),
      newNoticeRow(5, {
        createdAt: T0,
        status: 'skipped',
        finishedAt: after(MINUTE),
      }),
      newNoticeRow(6, { userId: userIdOf(2), createdAt: after(2 * MINUTE) }),
    ]);

    expect(idsOf(await store.findPendingBefore(threshold, 100))).toEqual([
      noticeIdOf(3),
      noticeIdOf(6),
      noticeIdOf(1),
    ]);
    expect(idsOf(await store.findPendingBefore(threshold, 2))).toEqual([
      noticeIdOf(3),
      noticeIdOf(6),
    ]);
  });
});

describe('D1NoticeStoreの依頼済みと対象外の記録', () => {
  test('依頼済みの記録は依頼待ちのときだけ進めて完了の時刻を書き、2回目・対象外の行・無い行では進めない', async () => {
    await insertNoticeRows([
      newNoticeRow(1),
      newNoticeRow(2, { status: 'skipped', finishedAt: after(MINUTE) }),
    ]);

    expect(await store.markRequested(noticeIdOf(1), after(2 * MINUTE))).toBe(
      'updated',
    );
    expect(await store.markRequested(noticeIdOf(1), after(3 * MINUTE))).toBe(
      'not_pending',
    );
    expect(await store.markRequested(noticeIdOf(2), after(3 * MINUTE))).toBe(
      'not_pending',
    );
    expect(await store.markRequested(noticeIdOf(3), after(3 * MINUTE))).toBe(
      'not_pending',
    );

    const requested = await readNoticeRow(noticeIdOf(1));
    expect(requested).toMatchObject({
      status: 'requested',
      finishedAt: after(2 * MINUTE),
    });
    expect(requested?.updatedAt.getTime()).toBeGreaterThan(T0.getTime());
    expect(await readNoticeRow(noticeIdOf(2))).toMatchObject({
      status: 'skipped',
      finishedAt: after(MINUTE),
      updatedAt: T0,
    });
  });

  test('対象外の記録は依頼待ちのときだけ書き、依頼済みの行を変えない', async () => {
    await insertNoticeRows([
      newNoticeRow(1),
      newNoticeRow(2, { status: 'requested', finishedAt: after(MINUTE) }),
    ]);

    await store.markSkipped(noticeIdOf(1), after(2 * MINUTE));
    await store.markSkipped(noticeIdOf(2), after(2 * MINUTE));

    expect(await readNoticeRow(noticeIdOf(1))).toMatchObject({
      status: 'skipped',
      finishedAt: after(2 * MINUTE),
    });
    expect(await readNoticeRow(noticeIdOf(2))).toMatchObject({
      status: 'requested',
      finishedAt: after(MINUTE),
      updatedAt: T0,
    });
    expect(
      await store.findPendingBySubscription(stripeSubscriptionIdOf(1)),
    ).toEqual([]);
  });
});

describe('D1NoticeStoreの依頼を終えた依頼の削除', () => {
  test('依頼済み・対象外で完了から指定の日時以前の依頼だけを完了の古い順に上限の件数まで消し、消した件数を返す', async () => {
    await insertNoticeRows([
      newNoticeRow(1, { status: 'requested', finishedAt: after(3 * DAY) }),
      newNoticeRow(2, { status: 'skipped', finishedAt: after(DAY) }),
      newNoticeRow(3, { status: 'requested', finishedAt: after(2 * DAY) }),
      newNoticeRow(4),
      newNoticeRow(5, {
        status: 'requested',
        finishedAt: after(3 * DAY + 1),
      }),
    ]);

    expect(await store.deleteFinishedBefore(after(3 * DAY), 2)).toBe(2);
    expect(await readNoticeIds()).toEqual([1, 4, 5].map(noticeIdOf));

    expect(await store.deleteFinishedBefore(after(3 * DAY), 2)).toBe(1);
    expect(await store.deleteFinishedBefore(after(3 * DAY), 2)).toBe(0);
    expect(await readNoticeIds()).toEqual([4, 5].map(noticeIdOf));
  });

  test('上限が90件を超えても1つの文で消し、バインド変数の上限に収まる', async () => {
    await insertNoticeRows(
      range(1, 95).map((index) =>
        newNoticeRow(index, {
          status: index % 2 === 0 ? 'requested' : 'skipped',
          finishedAt: after(index),
        }),
      ),
    );
    await insertNoticeRow(newNoticeRow(96));
    const { database, placeholderCounts } = createRecordingDatabase();

    expect(
      await new D1NoticeStore(database).deleteFinishedBefore(after(DAY), 95),
    ).toBe(95);

    expect(placeholderCounts).toHaveLength(1);
    expectWithinBindLimit(placeholderCounts);
    expect(await readNoticeIds()).toEqual([noticeIdOf(96)]);
  });
});

describe('D1NoticeStoreの利用者の行の削除', () => {
  test('削除の文は利用者の依頼だけを消す', async () => {
    await insertNoticeRows([
      newNoticeRow(1),
      newNoticeRow(2, { status: 'requested', finishedAt: after(DAY) }),
      newNoticeRow(3, { userId: userIdOf(2) }),
    ]);

    await db.batch([store.deleteByUser(userIdOf(1))]);

    expect(await readNoticeIds()).toEqual([noticeIdOf(3)]);
  });
});

describe('スキーマの列挙とcoreの型の同期', () => {
  test('メールの依頼の種別と状態の列挙はcoreのユニオンと同じ集合である', () => {
    expectTypeOf<
      (typeof ULTRAS_NOTICE_KIND_VALUES)[number]
    >().toEqualTypeOf<UltrasNoticeKind>();
    expectTypeOf<
      (typeof ULTRAS_NOTICE_STATUS_VALUES)[number]
    >().toEqualTypeOf<UltrasNoticeStatus>();
  });
});
