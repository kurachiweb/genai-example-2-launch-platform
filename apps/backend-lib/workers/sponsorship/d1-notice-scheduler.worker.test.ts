import { beforeEach, describe, expect, test } from 'vitest';

import type { Clock } from '../../core/time/clock.ts';
import { parseBusinessDate } from '../../core/time/business-time.ts';
import { D1NoticeScheduler } from './d1-notice-scheduler.ts';
import {
  clearSponsorshipTables,
  db,
  insertSponsorProduct,
  insertSponsorships,
  insertSponsorUser,
  paidColumnsOf,
  readSponsorshipRow,
  type SponsorshipFixture,
  T0,
  TODAY,
  terminatedColumnsOf,
} from './testing/sponsorship-fixtures.ts';

const FIRST_RUN_AT = new Date('2026-11-25T08:07:00.000Z');

const SECOND_RUN_AT = new Date('2026-11-25T12:21:00.000Z');

const today = parseBusinessDate(TODAY);

function clockAt(instant: Date): Clock {
  return { now: () => new Date(instant) };
}

function schedulerAt(instant: Date = FIRST_RUN_AT): D1NoticeScheduler {
  return new D1NoticeScheduler(db, clockAt(instant));
}

const STARTS_TODAY = { startsOn: TODAY, endsOn: '2026-12-01', days: 7 };

const ENDED_YESTERDAY = {
  startsOn: '2026-11-18',
  endsOn: '2026-11-24',
  days: 7,
} as const;

function sponsorshipOf(
  index: number,
  columns: SponsorshipFixture['columns'],
): SponsorshipFixture {
  return { index, owner: 1, product: 1, columns };
}

async function noticesOf(index: number): Promise<{
  readonly startNotice: string | undefined;
  readonly endNotice: string | undefined;
  readonly terminationNotice: string | undefined;
  readonly updatedAt: Date | undefined;
}> {
  const row = await readSponsorshipRow(index);
  return {
    startNotice: row?.startNotice,
    endNotice: row?.endNotice,
    terminationNotice: row?.terminationNotice,
    updatedAt: row?.updatedAt,
  };
}

beforeEach(async () => {
  await clearSponsorshipTables();
  await insertSponsorUser(1);
  await insertSponsorProduct({ index: 1, owner: 1 });
});

describe('D1NoticeScheduler', () => {
  describe('markDue', () => {
    test('開始日が今日の決済済みの申込の開始の通知を依頼待ちにし、更新日時を記録の時刻にする', async () => {
      await insertSponsorships([
        sponsorshipOf(1, paidColumnsOf(1, STARTS_TODAY)),
      ]);

      await schedulerAt().markDue(today);

      expect(await noticesOf(1)).toEqual({
        startNotice: 'pending',
        endNotice: 'none',
        terminationNotice: 'none',
        updatedAt: FIRST_RUN_AT,
      });
    });

    test('開始日が今日でない・未決済・強制終了・論理削除の申込の開始の通知は依頼待ちにしない', async () => {
      await insertSponsorships([
        sponsorshipOf(
          1,
          paidColumnsOf(1, {
            startsOn: '2026-11-26',
            endsOn: '2026-12-02',
            days: 7,
          }),
        ),
        sponsorshipOf(
          2,
          paidColumnsOf(2, {
            startsOn: '2026-11-24',
            endsOn: '2026-11-30',
            days: 7,
          }),
        ),
        sponsorshipOf(3, STARTS_TODAY),
        sponsorshipOf(4, terminatedColumnsOf(4, STARTS_TODAY)),
        sponsorshipOf(5, paidColumnsOf(5, { ...STARTS_TODAY, deletedAt: T0 })),
      ]);

      await schedulerAt().markDue(today);

      for (const index of [1, 2, 3, 4, 5]) {
        expect(await noticesOf(index)).toEqual({
          startNotice: 'none',
          endNotice: 'none',
          terminationNotice: 'none',
          updatedAt: T0,
        });
      }
    });

    test('終了日が過ぎて表示停止の返金を精算した決済済みの申込の終了の通知を、終了日が2日以上前でも依頼待ちにする', async () => {
      await insertSponsorships([
        sponsorshipOf(
          1,
          paidColumnsOf(1, {
            ...ENDED_YESTERDAY,
            startNotice: 'requested',
            stopRefundStatus: 'not_needed',
          }),
        ),
        sponsorshipOf(
          2,
          paidColumnsOf(2, {
            startsOn: '2026-11-01',
            endsOn: '2026-11-10',
            days: 10,
            startNotice: 'skipped',
            stopRefundStatus: 'requested',
            stopRefundDays: 2,
            stopRefundAmount: 1_400,
          }),
        ),
        sponsorshipOf(
          3,
          paidColumnsOf(3, {
            ...ENDED_YESTERDAY,
            stopRefundStatus: 'rejected',
          }),
        ),
      ]);

      await schedulerAt().markDue(today);

      expect(await noticesOf(1)).toEqual({
        startNotice: 'requested',
        endNotice: 'pending',
        terminationNotice: 'none',
        updatedAt: FIRST_RUN_AT,
      });
      expect(await noticesOf(2)).toEqual({
        startNotice: 'skipped',
        endNotice: 'pending',
        terminationNotice: 'none',
        updatedAt: FIRST_RUN_AT,
      });
      expect((await noticesOf(3)).endNotice).toBe('pending');
    });

    test('表示停止の返金を未精算・終了日が今日以降・未決済・強制終了・論理削除の申込の終了の通知は依頼待ちにしない', async () => {
      await insertSponsorships([
        sponsorshipOf(1, paidColumnsOf(1, ENDED_YESTERDAY)),
        sponsorshipOf(
          2,
          paidColumnsOf(2, {
            startsOn: '2026-11-19',
            endsOn: TODAY,
            days: 7,
            stopRefundStatus: 'not_needed',
          }),
        ),
        sponsorshipOf(3, {
          ...ENDED_YESTERDAY,
          stopRefundStatus: 'not_needed',
        }),
        sponsorshipOf(
          4,
          terminatedColumnsOf(4, {
            ...ENDED_YESTERDAY,
            stopRefundStatus: 'not_needed',
          }),
        ),
        sponsorshipOf(
          5,
          paidColumnsOf(5, {
            ...ENDED_YESTERDAY,
            stopRefundStatus: 'not_needed',
            deletedAt: T0,
          }),
        ),
      ]);

      await schedulerAt().markDue(today);

      for (const index of [1, 2, 3, 4, 5]) {
        expect(await noticesOf(index)).toEqual({
          startNotice: 'none',
          endNotice: 'none',
          terminationNotice: 'none',
          updatedAt: T0,
        });
      }
    });

    test('依頼済み・送らないと決めた通知と依頼待ちの通知は戻さず、更新日時も変えない', async () => {
      await insertSponsorships([
        sponsorshipOf(
          1,
          paidColumnsOf(1, { ...STARTS_TODAY, startNotice: 'requested' }),
        ),
        sponsorshipOf(
          2,
          paidColumnsOf(2, { ...STARTS_TODAY, startNotice: 'skipped' }),
        ),
        sponsorshipOf(
          3,
          paidColumnsOf(3, { ...STARTS_TODAY, startNotice: 'pending' }),
        ),
        sponsorshipOf(
          4,
          paidColumnsOf(4, {
            ...ENDED_YESTERDAY,
            stopRefundStatus: 'not_needed',
            endNotice: 'requested',
          }),
        ),
        sponsorshipOf(
          5,
          paidColumnsOf(5, {
            ...ENDED_YESTERDAY,
            stopRefundStatus: 'not_needed',
            endNotice: 'skipped',
          }),
        ),
      ]);

      await schedulerAt().markDue(today);

      expect(await noticesOf(1)).toMatchObject({
        startNotice: 'requested',
        updatedAt: T0,
      });
      expect(await noticesOf(2)).toMatchObject({
        startNotice: 'skipped',
        updatedAt: T0,
      });
      expect(await noticesOf(3)).toMatchObject({
        startNotice: 'pending',
        updatedAt: T0,
      });
      expect(await noticesOf(4)).toMatchObject({
        endNotice: 'requested',
        updatedAt: T0,
      });
      expect(await noticesOf(5)).toMatchObject({
        endNotice: 'skipped',
        updatedAt: T0,
      });
    });

    test('2回実行しても1回目の結果と同じで、更新日時も1回目のまま', async () => {
      await insertSponsorships([
        sponsorshipOf(1, paidColumnsOf(1, STARTS_TODAY)),
        sponsorshipOf(
          2,
          paidColumnsOf(2, {
            ...ENDED_YESTERDAY,
            stopRefundStatus: 'not_needed',
          }),
        ),
        sponsorshipOf(3, paidColumnsOf(3, ENDED_YESTERDAY)),
      ]);

      await schedulerAt(FIRST_RUN_AT).markDue(today);
      const afterFirst = await Promise.all([1, 2, 3].map(noticesOf));
      await schedulerAt(SECOND_RUN_AT).markDue(today);

      expect(await Promise.all([1, 2, 3].map(noticesOf))).toEqual(afterFirst);
      expect(afterFirst).toEqual([
        expect.objectContaining({
          startNotice: 'pending',
          updatedAt: FIRST_RUN_AT,
        }),
        expect.objectContaining({
          endNotice: 'pending',
          updatedAt: FIRST_RUN_AT,
        }),
        expect.objectContaining({ endNotice: 'none', updatedAt: T0 }),
      ]);
    });

    test('対象が無くても失敗しない', async () => {
      await expect(schedulerAt().markDue(today)).resolves.toBeUndefined();
    });
  });

  describe('hasPending', () => {
    test('依頼待ちの通知が無ければfalseを返す', async () => {
      await insertSponsorships([
        sponsorshipOf(
          1,
          paidColumnsOf(1, {
            ...ENDED_YESTERDAY,
            startNotice: 'requested',
            endNotice: 'skipped',
          }),
        ),
        sponsorshipOf(
          2,
          terminatedColumnsOf(2, { terminationNotice: 'requested' }),
        ),
      ]);

      expect(await schedulerAt().hasPending()).toBe(false);
    });

    test.each([
      ['開始', { startNotice: 'pending' }],
      ['終了', { endNotice: 'pending' }],
      ['強制終了', { terminationNotice: 'pending' }],
    ] as const)('%sの通知が依頼待ちならtrueを返す', async (_label, columns) => {
      await insertSponsorships([
        sponsorshipOf(1, paidColumnsOf(1)),
        sponsorshipOf(2, terminatedColumnsOf(2, columns)),
      ]);

      expect(await schedulerAt().hasPending()).toBe(true);
    });

    test('記録した依頼待ちの通知を判定に含める', async () => {
      await insertSponsorships([
        sponsorshipOf(1, paidColumnsOf(1, STARTS_TODAY)),
      ]);
      const scheduler = schedulerAt();

      expect(await scheduler.hasPending()).toBe(false);
      await scheduler.markDue(today);
      expect(await scheduler.hasPending()).toBe(true);
    });
  });
});
