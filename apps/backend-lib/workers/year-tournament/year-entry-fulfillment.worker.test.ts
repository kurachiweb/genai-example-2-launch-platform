import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { yearTournamentEntries } from '../../../db/schema/tournament/year-tournament-entries.ts';
import { yearTournaments } from '../../../db/schema/tournament/year-tournaments.ts';
import type { FulfillablePurchase } from '../../core/payments/purchase-kind-contract.ts';
import { parseBusinessDate } from '../../core/time/business-time.ts';
import { yearScheduleFor } from '../../core/year-tournament/year-schedule.ts';
import type { FulfillmentPlan } from '../payments/fulfillment-contract.ts';
import { purchaseIdOf } from '../payments/testing/payment-store-fixtures.ts';
import { D1ProductDirectory } from '../product/d1-product-directory.ts';
import {
  db,
  insertLaunch,
  insertProduct,
  insertUser,
  launchIdOf,
  T0,
  userIdOf,
} from '../product/testing/product-fixtures.ts';
import { D1YearEntryStore } from './d1-year-entry-store.ts';
import { D1YearTournamentStore } from './d1-year-tournament-store.ts';
import {
  clearYearTournamentTables,
  insertYearEntries,
  insertYearTournaments,
  YEAR,
  YEAR_SCHEDULE,
  type YearEntryFixture,
  yearEntryIdOf,
} from './testing/year-tournament-fixtures.ts';
import { YearTournamentCalendar } from './year-calendar.ts';
import { YearEntryFulfillment } from './year-entry-fulfillment.ts';

const OWNER = 1;
const OTHER_USER = 2;

// 参加の枠の既定のWeek優勝の日時(2026-11-23の23:45)
const AWARDED_AT = new Date('2026-11-24T07:45:00.000Z');
const PAID_AT = new Date('2026-11-25T12:00:00.000Z');

// 2027年に明示した決勝日。決済期限は既定の5/24より前の5/10(月)23:35
const EXPLICIT_SCHEDULE = yearScheduleFor(
  YEAR,
  parseBusinessDate('2027-05-16'),
);

const REJECTED: FulfillmentPlan = { kind: 'reject', reason: 'ineligible' };

const store = new D1YearEntryStore(db);

function createFulfillment(): YearEntryFulfillment {
  return new YearEntryFulfillment(
    store,
    new YearTournamentCalendar(new D1YearTournamentStore(db)),
    new D1ProductDirectory(db),
  );
}

function purchaseOf(
  input: {
    readonly user?: number;
    readonly launch?: number | null;
    readonly paidAt?: Date;
  } = {},
): FulfillablePurchase {
  const launch = input.launch === undefined ? 1 : input.launch;
  return {
    purchaseId: purchaseIdOf(1),
    userId: userIdOf(input.user ?? OWNER),
    kind: 'year_tournament_entry',
    targetId: launch === null ? null : launchIdOf(launch),
    relatedId: launch === null ? null : launchIdOf(launch),
    quantity: 1,
    amountTotal: 1000,
    paymentRecordId: '01JC0REC0RD000000000000001',
    paidAt: input.paidAt ?? PAID_AT,
    stripeSubscriptionId: null,
  };
}

// 投稿者1のプロダクト・Week優勝したローンチ・参加の枠を同じ番号で作る
async function seedEntry(
  index: number,
  options: {
    readonly entry?: YearEntryFixture['columns'];
    readonly product?: Parameters<typeof insertProduct>[2];
  } = {},
): Promise<void> {
  await insertProduct(index, OWNER, options.product);
  await insertLaunch(index, index, {
    launchDate: '2026-11-20',
    outcome: 'won',
    decidedAt: AWARDED_AT,
  });
  await insertYearEntries([
    {
      index,
      launch: index,
      product: index,
      owner: OWNER,
      columns: options.entry,
    },
  ]);
}

// 2027年の組み合わせ決定を始めた(凍結した)状態にする
async function freezeYear(): Promise<void> {
  await db
    .update(yearTournaments)
    .set({ status: 'drawing', drawStartedAt: YEAR_SCHEDULE.drawAt })
    .where(eq(yearTournaments.year, YEAR));
}

async function readEntry(index: number) {
  const [row] = await db
    .select({
      status: yearTournamentEntries.status,
      entitlementSource: yearTournamentEntries.entitlementSource,
      purchaseId: yearTournamentEntries.purchaseId,
      entitledAt: yearTournamentEntries.entitledAt,
      updatedAt: yearTournamentEntries.updatedAt,
    })
    .from(yearTournamentEntries)
    .where(eq(yearTournamentEntries.id, yearEntryIdOf(index)));
  return row;
}

const AWAITING_ENTRY = Object.freeze({
  status: 'awaiting_payment',
  entitlementSource: null,
  purchaseId: null,
  entitledAt: null,
  updatedAt: T0,
});

function fulfilledStatements(plan: FulfillmentPlan) {
  if (plan.kind !== 'fulfill') {
    throw new Error(`参加資格の付与を拒否しました: ${plan.reason}`);
  }
  const [first, ...rest] = plan.statements;
  if (first === undefined) {
    throw new Error('付与の文がありません');
  }
  return [first, ...rest] as const;
}

async function commit(plan: FulfillmentPlan): Promise<void> {
  await db.batch(fulfilledStatements(plan));
}

// 2027年の決済期限(2027-05-24の23:35、UTC-08:00)からの秒のずれで反映の時刻を作る
function secondsAfterDeadline(seconds: number): Date {
  return new Date(YEAR_SCHEDULE.deadlineAt.getTime() + seconds * 1000);
}

beforeEach(async () => {
  await clearYearTournamentTables();
  await insertUser(OWNER);
  await insertUser(OTHER_USER);
  await insertYearTournaments([{ index: 1 }]);
});

describe('YearEntryFulfillment', () => {
  describe('受付中の枠への付与', () => {
    test('付与の文1つを返し、実行すると決済の出どころと購入を記録して参加資格を与える', async () => {
      await seedEntry(1);
      const plan = await createFulfillment().prepare(purchaseOf(), db);

      expect(plan.kind).toBe('fulfill');
      expect(plan.kind === 'fulfill' && plan.statements).toHaveLength(1);
      expect(await readEntry(1)).toStrictEqual(AWAITING_ENTRY);

      await commit(plan);

      expect(await readEntry(1)).toStrictEqual({
        status: 'entitled',
        entitlementSource: 'payment',
        purchaseId: purchaseIdOf(1),
        entitledAt: PAID_AT,
        updatedAt: PAID_AT,
      });
    });

    test('同じ購入に何度呼ばれても同じ判断を返し、書き込みは行わない', async () => {
      await seedEntry(1);
      const fulfillment = createFulfillment();

      const first = await fulfillment.prepare(purchaseOf(), db);
      const second = await fulfillment.prepare(purchaseOf(), db);

      expect(first.kind).toBe('fulfill');
      expect(second.kind).toBe('fulfill');
      expect(await readEntry(1)).toStrictEqual(AWAITING_ENTRY);
    });

    test('付与した枠に同じ購入を再び確かめると、参加資格を得た枠として拒否する', async () => {
      await seedEntry(1);
      const fulfillment = createFulfillment();
      await commit(await fulfillment.prepare(purchaseOf(), db));

      expect(await fulfillment.prepare(purchaseOf(), db)).toStrictEqual(
        REJECTED,
      );
    });

    test('対象年の行が無くても、既定の日程で付与し、年の行を作らない', async () => {
      await db.delete(yearTournaments);
      await seedEntry(1);

      const plan = await createFulfillment().prepare(purchaseOf(), db);

      expect(plan.kind).toBe('fulfill');
      expect(await db.select().from(yearTournaments)).toHaveLength(0);
    });

    test('非公開化中のプロダクトの枠には付与する(除外は組み合わせ決定で行う)', async () => {
      await seedEntry(1, { product: { hiddenAt: T0 } });

      const plan = await createFulfillment().prepare(purchaseOf(), db);

      expect(plan.kind).toBe('fulfill');
    });
  });

  describe('付与できない枠の拒否', () => {
    test('対象のローンチが無い購入は拒否する', async () => {
      await seedEntry(1);

      expect(
        await createFulfillment().prepare(purchaseOf({ launch: null }), db),
      ).toStrictEqual(REJECTED);
    });

    test('ローンチに参加の枠が無ければ拒否する', async () => {
      await insertProduct(1, OWNER);
      await insertLaunch(1, 1, { launchDate: '2026-11-20' });

      expect(await createFulfillment().prepare(purchaseOf(), db)).toStrictEqual(
        REJECTED,
      );
    });

    test('投稿者以外の購入は拒否する', async () => {
      await seedEntry(1);

      expect(
        await createFulfillment().prepare(purchaseOf({ user: OTHER_USER }), db),
      ).toStrictEqual(REJECTED);
    });

    test.each([
      {
        label: 'ultras',
        columns: { status: 'entitled', entitlementSource: 'ultras' },
      },
      {
        label: 'payment',
        columns: {
          status: 'entitled',
          entitlementSource: 'payment',
          purchaseId: purchaseIdOf(2),
        },
      },
      {
        label: 'ultras',
        columns: {
          status: 'drawn',
          entitlementSource: 'ultras',
          classifiedYear: YEAR,
        },
      },
      {
        label: 'deadline',
        columns: {
          status: 'expired',
          closeReason: 'deadline',
          classifiedYear: YEAR,
        },
      },
      {
        label: 'late_entry',
        columns: {
          status: 'expired',
          closeReason: 'late_entry',
          classifiedYear: YEAR,
        },
      },
      {
        label: 'deleted',
        columns: { status: 'forfeited', closeReason: 'deleted' },
      },
      {
        label: 'withdrawn',
        columns: { status: 'forfeited', closeReason: 'withdrawn' },
      },
      {
        label: 'hidden_or_suspended',
        columns: {
          status: 'excluded',
          closeReason: 'hidden_or_suspended',
          classifiedYear: YEAR,
        },
      },
      {
        label: 'over_capacity',
        columns: {
          status: 'excluded',
          closeReason: 'over_capacity',
          classifiedYear: YEAR,
        },
      },
    ] as const)(
      '$columns.status($label)の枠は拒否する',
      async ({ columns }) => {
        await seedEntry(1, { entry: columns });

        expect(
          await createFulfillment().prepare(purchaseOf(), db),
        ).toStrictEqual(REJECTED);
      },
    );

    test('組み合わせ決定の凍結の後の受付中の枠は拒否する', async () => {
      await seedEntry(1);
      await freezeYear();

      expect(await createFulfillment().prepare(purchaseOf(), db)).toStrictEqual(
        REJECTED,
      );
    });

    test('論理削除済みのプロダクトの枠は拒否する', async () => {
      await seedEntry(1, { product: { deletedAt: T0 } });

      expect(await createFulfillment().prepare(purchaseOf(), db)).toStrictEqual(
        REJECTED,
      );
    });
  });

  describe('決済期限の後の反映と新しいローンチ(仮6)', () => {
    async function seedWithNewerLaunch(
      columns: Parameters<typeof insertLaunch>[2] = {},
    ): Promise<void> {
      await seedEntry(1);
      await insertLaunch(2, 1, { launchDate: '2027-05-26', ...columns });
    }

    test.each([
      { label: '23:34', paidAt: secondsAfterDeadline(-60) },
      { label: '23:35:00ちょうど', paidAt: secondsAfterDeadline(0) },
    ])(
      '決済期限まで($label)の反映は新しいローンチがあっても付与する',
      async ({ paidAt }) => {
        await seedWithNewerLaunch();

        const plan = await createFulfillment().prepare(
          purchaseOf({ paidAt }),
          db,
        );
        await commit(plan);

        expect(await readEntry(1)).toMatchObject({
          status: 'entitled',
          entitlementSource: 'payment',
          purchaseId: purchaseIdOf(1),
          entitledAt: paidAt,
        });
      },
    );

    test.each([
      { label: '23:35:01', paidAt: secondsAfterDeadline(1) },
      { label: '23:44', paidAt: secondsAfterDeadline(9 * 60) },
    ])(
      '決済期限より後($label)の反映は新しいローンチがあれば拒否する',
      async ({ paidAt }) => {
        await seedWithNewerLaunch();

        expect(
          await createFulfillment().prepare(purchaseOf({ paidAt }), db),
        ).toStrictEqual(REJECTED);
      },
    );

    test('決済期限より後の反映でも新しいローンチが無ければ付与する', async () => {
      await seedEntry(1);
      await insertLaunch(2, 1, {
        launchDate: '2026-11-10',
        outcome: 'lost',
        decidedAt: T0,
      });

      const plan = await createFulfillment().prepare(
        purchaseOf({ paidAt: secondsAfterDeadline(1) }),
        db,
      );

      expect(plan.kind).toBe('fulfill');
    });

    test('決済期限より後の反映で新しいローンチが取消済みだけなら付与する', async () => {
      await seedWithNewerLaunch({ cancelledAt: secondsAfterDeadline(-1) });

      const plan = await createFulfillment().prepare(
        purchaseOf({ paidAt: secondsAfterDeadline(1) }),
        db,
      );

      expect(plan.kind).toBe('fulfill');
    });

    test('決勝日を明示した年では、その年の決済期限で判定する', async () => {
      await db.delete(yearTournaments);
      await insertYearTournaments([
        {
          index: 1,
          columns: {
            finalDate: EXPLICIT_SCHEDULE.finalDate,
            finalDateSource: 'explicit',
            finalDateVersion: 1,
            deadlineDate: EXPLICIT_SCHEDULE.deadlineDate,
            acceptUntil: EXPLICIT_SCHEDULE.acceptUntil,
            deadlineAt: EXPLICIT_SCHEDULE.deadlineAt,
            drawAt: EXPLICIT_SCHEDULE.drawAt,
            changeLockAt: EXPLICIT_SCHEDULE.changeLockAt,
          },
        },
      ]);
      await seedEntry(1);
      await insertLaunch(2, 1, { launchDate: '2027-05-12' });

      expect(
        await createFulfillment().prepare(
          purchaseOf({
            paidAt: new Date(EXPLICIT_SCHEDULE.deadlineAt.getTime() + 1000),
          }),
          db,
        ),
      ).toStrictEqual(REJECTED);
    });
  });

  describe('準備と確定の間の変更', () => {
    test('返した文を凍結の後に一括の書き込みで実行するとNOT NULL制約の違反で失敗し、枠は変わらない', async () => {
      await seedEntry(1);
      const plan = await createFulfillment().prepare(purchaseOf(), db);
      await freezeYear();

      await expect(commit(plan)).rejects.toThrow(
        /NOT NULL constraint failed: year_tournament_entries\.status/u,
      );
      expect(await readEntry(1)).toStrictEqual(AWAITING_ENTRY);
    });

    test('返した文をUltrasによる付与の後に実行するとNOT NULL制約の違反で失敗し、Ultrasの付与が残る', async () => {
      await seedEntry(1);
      const plan = await createFulfillment().prepare(purchaseOf(), db);
      const activatedAt = new Date(AWARDED_AT.getTime() + 60_000);
      await store.grantByUltras([yearEntryIdOf(1)], activatedAt);

      await expect(commit(plan)).rejects.toThrow(
        /NOT NULL constraint failed: year_tournament_entries\.status/u,
      );
      expect(await readEntry(1)).toStrictEqual({
        status: 'entitled',
        entitlementSource: 'ultras',
        purchaseId: null,
        entitledAt: activatedAt,
        updatedAt: activatedAt,
      });
    });

    test('返した文を喪失の後に実行するとNOT NULL制約の違反で失敗し、喪失が残る', async () => {
      await seedEntry(1);
      const plan = await createFulfillment().prepare(purchaseOf(), db);
      await store.forfeitByOwner(userIdOf(OWNER), PAID_AT);

      await expect(commit(plan)).rejects.toThrow(
        /NOT NULL constraint failed: year_tournament_entries\.status/u,
      );
      expect(await readEntry(1)).toMatchObject({
        status: 'forfeited',
        purchaseId: null,
      });
    });
  });

  describe('決済済みの枠とUltras', () => {
    test('決済で参加資格を得た枠は、後からUltrasに加入しても変わらない', async () => {
      await seedEntry(1);
      await commit(await createFulfillment().prepare(purchaseOf(), db));
      const activatedAt = new Date(PAID_AT.getTime() + 60_000);

      expect(
        await store.grantByUltras([yearEntryIdOf(1)], activatedAt),
      ).toStrictEqual([]);
      expect(await readEntry(1)).toStrictEqual({
        status: 'entitled',
        entitlementSource: 'payment',
        purchaseId: purchaseIdOf(1),
        entitledAt: PAID_AT,
        updatedAt: PAID_AT,
      });
    });
  });
});
