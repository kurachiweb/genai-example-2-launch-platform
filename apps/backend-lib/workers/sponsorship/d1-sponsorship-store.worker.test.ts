import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, test } from 'vitest';

import { createDatabase } from '../../../db/client.ts';
import type { SponsorshipTier } from '../../../common-lib/sponsorship/sponsorship-tiers.ts';
import type { SponsorshipRecord } from '../../core/sponsorship/ports.ts';
import {
  type BusinessDate,
  parseBusinessDate,
} from '../../core/time/business-time.ts';
import { D1SponsorshipStore } from './d1-sponsorship-store.ts';
import {
  clearSponsorshipTables,
  createSequentialSponsorshipIds,
  db,
  DEFAULT_AMOUNT_TOTAL,
  insertSponsorProduct,
  insertSponsorships,
  insertSponsorUser,
  paidColumnsOf,
  productIdOf,
  readSponsorshipIds,
  readSponsorshipRow,
  type SponsorshipFixture,
  sponsorshipIdOf,
  sponsorshipPaymentRecordIdOf,
  sponsorshipPurchaseIdOf,
  sponsorshipRefundIdOf,
  T0,
  TODAY,
  terminatedColumnsOf,
  userIdOf,
} from './testing/sponsorship-fixtures.ts';

const AT = new Date('2026-11-25T09:30:00.000Z');

const store = new D1SponsorshipStore(db, createSequentialSponsorshipIds());

const NO_REFUND = Object.freeze({
  status: 'none',
  days: null,
  amount: null,
  refundRequestId: null,
});

const date = (value: string): BusinessDate => parseBusinessDate(value);

const today = date(TODAY);

// 同じプロダクト・ティアの決済済みの掲載期間12/1〜12/7と比べる
function paidOf(
  index: number,
  columns: SponsorshipFixture['columns'] = {},
  { product = 1 }: { product?: number } = {},
): SponsorshipFixture {
  return {
    index,
    owner: 1,
    product,
    columns: paidColumnsOf(index, columns),
  };
}

const PRODUCT_DELETED = { productDeletedAt: T0 } as const;

const WITHDRAWN = { deletedAt: T0 } as const;

beforeEach(async () => {
  await clearSponsorshipTables();
  await insertSponsorUser(1);
  await insertSponsorUser(2);
  await insertSponsorProduct({ index: 1, owner: 1 });
  await insertSponsorProduct({ index: 2, owner: 1 });
  await insertSponsorProduct({ index: 3, owner: 2 });
});

describe('D1SponsorshipStore', () => {
  describe('create・findById', () => {
    test('未決済の申込を作成日時で作り、照会で同じ記録を返す', async () => {
      const created = await store.create(
        {
          userId: userIdOf(1),
          productId: productIdOf(1),
          tier: 'legend',
          startsOn: date('2026-12-01'),
          endsOn: date('2026-12-07'),
          days: 7,
        },
        AT,
      );

      const expected: SponsorshipRecord = {
        id: sponsorshipIdOf(1000),
        userId: userIdOf(1),
        productId: productIdOf(1),
        tier: 'legend',
        startsOn: date('2026-12-01'),
        endsOn: date('2026-12-07'),
        days: 7,
        state: 'pending_payment',
        purchaseId: null,
        paymentRecordId: null,
        amountTotal: null,
        paidAt: null,
        terminatedAt: null,
        terminationReason: null,
        productDeletedAt: null,
        terminationRefund: NO_REFUND,
        stopRefund: NO_REFUND,
        createdAt: AT,
      };
      expect(created).toEqual(expected);
      expect(await store.findById(created.id)).toEqual(expected);
      expect(await readSponsorshipRow(1000)).toMatchObject({
        startNotice: 'none',
        endNotice: 'none',
        terminationNotice: 'none',
        updatedAt: AT,
        deletedAt: null,
      });
    });

    test('論理削除済みと存在しない申込はundefinedを返す', async () => {
      await insertSponsorships([paidOf(1, WITHDRAWN)]);

      expect(await store.findById(sponsorshipIdOf(1))).toBeUndefined();
      expect(await store.findById(sponsorshipIdOf(2))).toBeUndefined();
    });

    test('強制終了と表示停止の返金の列を、状態・日数・金額・依頼の識別として読み、残りの全額の依頼は金額をnullで返す', async () => {
      const terminatedAt = new Date('2026-12-03T18:00:00.000Z');
      await insertSponsorships([
        {
          index: 1,
          owner: 1,
          product: 1,
          columns: terminatedColumnsOf(1, {
            terminatedAt,
            terminationReason: '虚偽の内容のため',
            productDeletedAt: null,
            terminationRefundStatus: 'requested',
            terminationRefundDays: 4,
            terminationRefundAmount: 4_000,
            terminationRefundRequestId: sponsorshipRefundIdOf(1),
            stopRefundStatus: 'requested',
            stopRefundDays: 2,
            stopRefundAmount: null,
            stopRefundRequestId: sponsorshipRefundIdOf(2),
          }),
        },
        {
          index: 2,
          owner: 1,
          product: 2,
          columns: paidColumnsOf(2, {
            productDeletedAt: T0,
            stopRefundStatus: 'rejected',
            stopRefundDays: 3,
            stopRefundAmount: 3_000,
          }),
        },
      ]);

      expect(await store.findById(sponsorshipIdOf(1))).toMatchObject({
        state: 'terminated',
        purchaseId: sponsorshipPurchaseIdOf(1),
        paymentRecordId: sponsorshipPaymentRecordIdOf(1),
        amountTotal: DEFAULT_AMOUNT_TOTAL,
        paidAt: T0,
        terminatedAt,
        terminationReason: '虚偽の内容のため',
        productDeletedAt: null,
        terminationRefund: {
          status: 'requested',
          days: 4,
          amount: 4_000,
          refundRequestId: sponsorshipRefundIdOf(1),
        },
        stopRefund: {
          status: 'requested',
          days: 2,
          amount: null,
          refundRequestId: sponsorshipRefundIdOf(2),
        },
      });
      expect(await store.findById(sponsorshipIdOf(2))).toMatchObject({
        state: 'paid',
        productDeletedAt: T0,
        terminationRefund: NO_REFUND,
        stopRefund: {
          status: 'rejected',
          days: 3,
          amount: 3_000,
          refundRequestId: null,
        },
      });
    });
  });

  describe('hasPaidOverlap', () => {
    async function overlaps(
      startsOn: string,
      endsOn: string,
      {
        tier = 'gold',
        product = 1,
        excludeId,
      }: { tier?: SponsorshipTier; product?: number; excludeId?: string } = {},
    ): Promise<boolean> {
      return store.hasPaidOverlap({
        productId: productIdOf(product),
        tier,
        startsOn: date(startsOn),
        endsOn: date(endsOn),
        ...(excludeId === undefined ? {} : { excludeId }),
      });
    }

    test.each([
      ['期間の内側', '2026-12-03', '2026-12-04', true],
      ['期間を含む', '2026-11-30', '2026-12-08', true],
      ['終了日が決済済みの開始日に接する', '2026-11-26', '2026-12-01', true],
      ['開始日が決済済みの終了日に接する', '2026-12-07', '2026-12-10', true],
      ['決済済みの開始日の前日に終わる', '2026-11-26', '2026-11-30', false],
      ['決済済みの終了日の翌日に始まる', '2026-12-08', '2026-12-10', false],
    ])(
      '%sの期間(%s〜%s)は重なりが%sになる',
      async (_label, startsOn, endsOn, expected) => {
        await insertSponsorships([paidOf(1)]);

        expect(await overlaps(startsOn, endsOn)).toBe(expected);
      },
    );

    test('異なるティア・異なるプロダクトの決済済みとは重ならない', async () => {
      await insertSponsorships([paidOf(1)]);

      expect(
        await overlaps('2026-12-01', '2026-12-07', { tier: 'silver' }),
      ).toBe(false);
      expect(await overlaps('2026-12-01', '2026-12-07', { product: 2 })).toBe(
        false,
      );
    });

    test.each([
      ['未決済', { state: 'pending_payment' }],
      [
        '強制終了',
        { state: 'terminated', terminatedAt: T0, terminationReason: '理由' },
      ],
      ['退会で論理削除された', WITHDRAWN],
      ['プロダクトの論理削除が記録された', PRODUCT_DELETED],
    ] as const)('%sの申込とは重ならない', async (_label, columns) => {
      await insertSponsorships([paidOf(1, columns)]);

      expect(await overlaps('2026-12-01', '2026-12-07')).toBe(false);
    });

    test('除く申込に指定した自分自身とは重ならない', async () => {
      await insertSponsorships([paidOf(1)]);

      expect(
        await overlaps('2026-12-01', '2026-12-07', {
          excludeId: sponsorshipIdOf(1),
        }),
      ).toBe(false);
      expect(
        await overlaps('2026-12-01', '2026-12-07', {
          excludeId: sponsorshipIdOf(2),
        }),
      ).toBe(true);
    });
  });

  describe('listPaidPeriods', () => {
    test('重なりの判定と同じ条件で、今日以降に終わる掲載期間を開始日の昇順で返す', async () => {
      await insertSponsorships([
        paidOf(1, { startsOn: '2026-12-10', endsOn: '2026-12-15' }),
        paidOf(2, { startsOn: '2026-11-10', endsOn: '2026-11-24' }),
        paidOf(3, { startsOn: '2026-11-20', endsOn: TODAY }),
        paidOf(4, { startsOn: '2026-12-01', endsOn: '2026-12-05' }),
        paidOf(5, { state: 'pending_payment' }),
        paidOf(6, {
          state: 'terminated',
          terminatedAt: T0,
          terminationReason: '理由',
        }),
        paidOf(7, { tier: 'silver' }),
        paidOf(8, WITHDRAWN),
        paidOf(9, PRODUCT_DELETED),
        paidOf(10, {}, { product: 2 }),
      ]);

      expect(
        await store.listPaidPeriods({
          productId: productIdOf(1),
          tier: 'gold',
          endsOnOrAfter: today,
        }),
      ).toEqual([
        { startsOn: '2026-11-20', endsOn: TODAY },
        { startsOn: '2026-12-01', endsOn: '2026-12-05' },
        { startsOn: '2026-12-10', endsOn: '2026-12-15' },
      ]);
    });
  });

  describe('countActiveForProduct', () => {
    test('決済済みで今日以降に終わる申込を、ティアを問わず数える', async () => {
      await insertSponsorships([
        paidOf(1, { startsOn: '2026-11-20', endsOn: TODAY }),
        paidOf(2),
        paidOf(3, { tier: 'legend' }),
        paidOf(4, { startsOn: '2026-11-10', endsOn: '2026-11-24' }),
        paidOf(5, { state: 'pending_payment' }),
        paidOf(6, {
          state: 'terminated',
          terminatedAt: T0,
          terminationReason: '理由',
        }),
        paidOf(7, WITHDRAWN),
        paidOf(8, PRODUCT_DELETED),
        paidOf(9, {}, { product: 2 }),
      ]);

      expect(await store.countActiveForProduct(productIdOf(1), today)).toBe(3);
      expect(await store.countActiveForProduct(productIdOf(3), today)).toBe(0);
    });
  });

  describe('deleteUnpaid', () => {
    test('未決済の申込だけを消し、決済済みの申込は残す', async () => {
      await insertSponsorships([{ index: 1, owner: 1, product: 1 }, paidOf(2)]);

      await store.deleteUnpaid(sponsorshipIdOf(1));
      await store.deleteUnpaid(sponsorshipIdOf(2));

      expect(await readSponsorshipIds()).toEqual([sponsorshipIdOf(2)]);
    });
  });

  describe('deleteExpiredUnpaid', () => {
    test('開始日が今日より前の未決済を、開始日の早い順に上限まで消して件数を返す', async () => {
      await insertSponsorships([
        {
          index: 1,
          owner: 1,
          product: 1,
          columns: { startsOn: '2026-11-24', endsOn: '2026-11-30' },
        },
        {
          index: 2,
          owner: 2,
          product: 3,
          columns: { startsOn: '2026-11-20', endsOn: '2026-11-30' },
        },
        {
          index: 3,
          owner: 1,
          product: 1,
          columns: { startsOn: TODAY, endsOn: '2026-11-30' },
        },
        paidOf(4, { startsOn: '2026-11-24', endsOn: '2026-11-30' }),
      ]);

      expect(await store.deleteExpiredUnpaid(today, 1)).toBe(1);
      expect(await readSponsorshipIds()).toEqual([
        sponsorshipIdOf(1),
        sponsorshipIdOf(3),
        sponsorshipIdOf(4),
      ]);
      expect(await store.deleteExpiredUnpaid(today, 1)).toBe(1);
      expect(await store.deleteExpiredUnpaid(today, 1)).toBe(0);
      expect(await readSponsorshipIds()).toEqual([
        sponsorshipIdOf(3),
        sponsorshipIdOf(4),
      ]);
    });
  });

  describe('listUnsettledEnded', () => {
    const ENDED = { startsOn: '2026-11-10', endsOn: '2026-11-24' } as const;

    test('終了日が過ぎた未精算の決済済みを、終了日とIDの昇順に上限まで返す', async () => {
      await insertSponsorships([
        paidOf(1, ENDED),
        paidOf(2, { startsOn: '2026-11-01', endsOn: '2026-11-20' }),
        paidOf(3, ENDED, { product: 2 }),
        paidOf(4, { startsOn: '2026-11-20', endsOn: TODAY }),
        paidOf(5, {
          ...ENDED,
          state: 'terminated',
          terminatedAt: T0,
          terminationReason: '理由',
        }),
        paidOf(6, { ...ENDED, ...WITHDRAWN }),
        paidOf(7, { ...ENDED, ...PRODUCT_DELETED }),
        paidOf(8, { ...ENDED, stopRefundStatus: 'not_needed' }),
        paidOf(9, { ...ENDED, state: 'pending_payment' }),
      ]);

      const ids = async (limit: number): Promise<string[]> =>
        (await store.listUnsettledEnded(today, limit)).map(({ id }) => id);

      expect(await ids(10)).toEqual([
        sponsorshipIdOf(2),
        sponsorshipIdOf(1),
        sponsorshipIdOf(3),
      ]);
      expect(await ids(2)).toEqual([sponsorshipIdOf(2), sponsorshipIdOf(1)]);
    });

    test('未精算か終了通知の未依頼の決済済みの部分索引で読む', async () => {
      const queries: string[] = [];
      const d1 = env.DB;
      const recording = createDatabase({
        prepare: (query) => {
          queries.push(query);
          return d1.prepare(query);
        },
        batch: d1.batch.bind(d1),
        exec: d1.exec.bind(d1),
        withSession: d1.withSession.bind(d1),
        // D1Databaseの型が非推奨のdumpも必須にするため、偽物でも渡す
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        dump: d1.dump.bind(d1),
      });

      await new D1SponsorshipStore(
        recording,
        createSequentialSponsorshipIds(),
      ).listUnsettledEnded(today, 20);

      expect(queries).toHaveLength(1);
      const query = queries[0] ?? '';
      const parameterCount = query.match(/\?/gu)?.length ?? 0;
      const plan = await d1
        .prepare(`EXPLAIN QUERY PLAN ${query}`)
        .bind(...Array.from({ length: parameterCount }, () => TODAY))
        .all<{ detail: string }>();
      expect(plan.results.map(({ detail }) => detail)).toEqual(
        expect.arrayContaining([
          expect.stringMatching(
            /sponsorships USING INDEX sponsorships_unsettled_end_idx\b/u,
          ),
        ]),
      );
    });
  });
});
