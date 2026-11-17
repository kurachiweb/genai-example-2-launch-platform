import { beforeEach, describe, expect, test } from 'vitest';

import { yearTournaments } from '../../../db/schema/tournament/year-tournaments.ts';
import type {
  PurchaseOffer,
  PurchaseOfferDecision,
} from '../../core/payments/purchase-kind-contract.ts';
import { parseBusinessDate } from '../../core/time/business-time.ts';
import type { UltrasEntitlements } from '../../core/ultras/ports.ts';
import { yearScheduleFor } from '../../core/year-tournament/year-schedule.ts';
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
} from './testing/year-tournament-fixtures.ts';
import { YearTournamentCalendar } from './year-calendar.ts';
import {
  YEAR_ENTRY_OFFER_REJECTION_MESSAGES,
  YearEntryOfferPolicy,
} from './year-entry-offer-policy.ts';

const OWNER = 1;
const OTHER_USER = 2;

// 参加の枠の既定のWeek優勝の日時(2026-11-23の23:45)
const AWARDED_AT = new Date('2026-11-24T07:45:00.000Z');
const NOW = new Date('2026-11-25T10:00:00.000Z');

const ADMIN_ID = '01JD0ADMN00000000000000001';

// 2027年に明示した決勝日。決済期限日は5/10(月)
const EXPLICIT_SCHEDULE = yearScheduleFor(
  YEAR,
  parseBusinessDate('2027-05-16'),
);

interface EntitlementQuery {
  readonly userId: string;
  readonly from: Date;
  readonly to: Date;
}

interface PolicyHarness {
  readonly policy: YearEntryOfferPolicy;
  readonly queries: EntitlementQuery[];
}

const unused = (): never => {
  throw new Error('この判定は使わない');
};

function createPolicy(entitled = false): PolicyHarness {
  const queries: EntitlementQuery[] = [];
  const entitlements: UltrasEntitlements = {
    isEntitledAt: unused,
    wasEntitledDuring: (userId, from, to) => {
      queries.push({ userId, from, to });
      return Promise.resolve(entitled);
    },
    entitledUsersAt: unused,
    entitledUsersDuring: unused,
    currentPlan: unused,
  };
  return {
    policy: new YearEntryOfferPolicy(
      new D1YearEntryStore(db),
      new YearTournamentCalendar(new D1YearTournamentStore(db)),
      new D1ProductDirectory(db),
      entitlements,
    ),
    queries,
  };
}

// 投稿者1のプロダクト・ローンチ・参加の枠を同じ番号で作る
async function seedEntry(
  index: number,
  options: {
    readonly entry?: YearEntryFixture['columns'];
    readonly product?: Parameters<typeof insertProduct>[2];
  } = {},
): Promise<void> {
  await insertProduct(index, OWNER, options.product);
  await insertLaunch(index, index);
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
  await insertYearTournaments([
    {
      index: 1,
      columns: { status: 'drawing', drawStartedAt: YEAR_SCHEDULE.drawAt },
    },
  ]);
}

async function countYearRows(): Promise<number> {
  return (await db.select().from(yearTournaments)).length;
}

function describeAs(
  policy: YearEntryOfferPolicy,
  input: {
    readonly user?: number;
    readonly launch?: number | null;
    readonly now?: Date;
  } = {},
): Promise<PurchaseOfferDecision> {
  const launch = input.launch === undefined ? 1 : input.launch;
  return policy.describe({
    userId: userIdOf(input.user ?? OWNER),
    targetId: launch === null ? null : launchIdOf(launch),
    now: input.now ?? NOW,
  });
}

function rejectionOf(
  code: keyof typeof YEAR_ENTRY_OFFER_REJECTION_MESSAGES,
): PurchaseOfferDecision {
  return {
    kind: 'unavailable',
    code,
    message: YEAR_ENTRY_OFFER_REJECTION_MESSAGES[code],
  };
}

function offerOf(decision: PurchaseOfferDecision): PurchaseOffer {
  if (decision.kind !== 'available') {
    throw new Error(`購入を受け付けませんでした: ${decision.code}`);
  }
  return decision.offer;
}

beforeEach(async () => {
  await clearYearTournamentTables();
  await insertUser(OWNER);
  await insertUser(OTHER_USER);
});

describe('YearEntryOfferPolicy', () => {
  describe('拒否の文言', () => {
    test('文言規則のYearトーナメントの決済の開始の拒否の文言を持つ', () => {
      expect(YEAR_ENTRY_OFFER_REJECTION_MESSAGES).toStrictEqual({
        year_entry_not_found: 'このYearトーナメントの参加枠は見つかりません。',
        year_entry_already_entitled:
          'このプロダクトはYearトーナメントの参加資格を得ています。',
        year_entry_closed: 'Yearトーナメントの参加受付は終了しました。',
        year_entry_product_unavailable:
          'このプロダクトは現在Yearトーナメントに参加できません。',
        year_entry_exempt: 'Ultrasの特典により参加費は免除されます。',
      });
      expect(Object.isFrozen(YEAR_ENTRY_OFFER_REJECTION_MESSAGES)).toBe(true);
    });
  });

  describe('参加の枠が見つからない', () => {
    test('ローンチに参加の枠が無ければyear_entry_not_foundで拒否する', async () => {
      await insertProduct(1, OWNER);
      await insertLaunch(1, 1);
      const { policy } = createPolicy();

      expect(await describeAs(policy)).toStrictEqual(
        rejectionOf('year_entry_not_found'),
      );
    });

    test('対象のローンチが指定されなければyear_entry_not_foundで拒否する', async () => {
      await seedEntry(1);
      const { policy } = createPolicy();

      expect(await describeAs(policy, { launch: null })).toStrictEqual(
        rejectionOf('year_entry_not_found'),
      );
    });

    test('投稿者以外の決済の開始はyear_entry_not_foundで拒否する', async () => {
      await seedEntry(1);
      const { policy, queries } = createPolicy();

      expect(await describeAs(policy, { user: OTHER_USER })).toStrictEqual(
        rejectionOf('year_entry_not_found'),
      );
      expect(queries).toStrictEqual([]);
    });
  });

  describe('参加資格を得た枠', () => {
    test.each([
      {
        status: 'entitled',
        entitlementSource: 'payment',
        purchaseId: '01JD0PVRCHASE0000000000001',
        entitledAt: T0,
      },
      { status: 'entitled', entitlementSource: 'ultras', entitledAt: T0 },
      {
        status: 'drawn',
        entitlementSource: 'ultras',
        entitledAt: T0,
        classifiedYear: YEAR,
      },
    ] as const)(
      '$status($entitlementSource)の枠はyear_entry_already_entitledで拒否する',
      async (columns) => {
        await seedEntry(1, { entry: columns });
        const { policy, queries } = createPolicy();

        expect(await describeAs(policy)).toStrictEqual(
          rejectionOf('year_entry_already_entitled'),
        );
        expect(queries).toStrictEqual([]);
      },
    );
  });

  describe('参加受付の終了', () => {
    test.each([
      { status: 'expired', closeReason: 'deadline', classifiedYear: YEAR },
      { status: 'expired', closeReason: 'late_entry', classifiedYear: YEAR },
      { status: 'forfeited', closeReason: 'deleted' },
      { status: 'forfeited', closeReason: 'withdrawn' },
      {
        status: 'excluded',
        closeReason: 'hidden_or_suspended',
        classifiedYear: YEAR,
      },
      {
        status: 'excluded',
        closeReason: 'over_capacity',
        classifiedYear: YEAR,
      },
    ] as const)(
      '$status($closeReason)の枠はyear_entry_closedで拒否する',
      async (columns) => {
        await seedEntry(1, { entry: columns });
        const { policy, queries } = createPolicy();

        expect(await describeAs(policy)).toStrictEqual(
          rejectionOf('year_entry_closed'),
        );
        expect(queries).toStrictEqual([]);
      },
    );

    test('対象年の組み合わせ決定の凍結の後の受付中の枠はyear_entry_closedで拒否する', async () => {
      await seedEntry(1);
      await freezeYear();
      const { policy, queries } = createPolicy();

      expect(await describeAs(policy)).toStrictEqual(
        rejectionOf('year_entry_closed'),
      );
      expect(queries).toStrictEqual([]);
    });

    test('凍結の後は表示できないプロダクトの枠もyear_entry_closedで拒否する', async () => {
      await seedEntry(1, { product: { hiddenAt: T0 } });
      await freezeYear();
      const { policy } = createPolicy();

      expect(await describeAs(policy)).toStrictEqual(
        rejectionOf('year_entry_closed'),
      );
    });
  });

  describe('表示できないプロダクト', () => {
    test.each([
      { label: '非公開化中', product: { hiddenAt: T0 } },
      { label: '論理削除済み', product: { deletedAt: T0 } },
    ])(
      '$labelのプロダクトの枠はyear_entry_product_unavailableで拒否する',
      async ({ product }) => {
        await seedEntry(1, { product });
        const { policy, queries } = createPolicy();

        expect(await describeAs(policy)).toStrictEqual(
          rejectionOf('year_entry_product_unavailable'),
        );
        expect(queries).toStrictEqual([]);
      },
    );
  });

  describe('Ultrasによる免除', () => {
    test('Week優勝から現在までにUltrasの期間があればyear_entry_exemptで拒否する', async () => {
      await seedEntry(1);
      const { policy, queries } = createPolicy(true);

      expect(await describeAs(policy)).toStrictEqual(
        rejectionOf('year_entry_exempt'),
      );
      expect(queries).toStrictEqual([
        { userId: userIdOf(OWNER), from: AWARDED_AT, to: NOW },
      ]);
    });

    test('決済期限の後の判定は期間の終わりを対象年の決済期限にする', async () => {
      await seedEntry(1);
      const { policy, queries } = createPolicy(true);
      const afterDeadline = new Date(YEAR_SCHEDULE.deadlineAt.getTime() + 1);

      expect(await describeAs(policy, { now: afterDeadline })).toStrictEqual(
        rejectionOf('year_entry_exempt'),
      );
      expect(queries).toStrictEqual([
        {
          userId: userIdOf(OWNER),
          from: AWARDED_AT,
          to: YEAR_SCHEDULE.deadlineAt,
        },
      ]);
    });
  });

  describe('購入の内容', () => {
    test('受付中の枠は行の無い年の既定の日程で参加費の購入の内容を返す', async () => {
      await seedEntry(1);
      const { policy, queries } = createPolicy();

      const decision = await describeAs(policy);

      expect(decision).toStrictEqual({
        kind: 'available',
        offer: {
          priceLookupKey: 'year_tournament_entry',
          quantity: 1,
          relatedId: launchIdOf(1),
          exclusivityKey: `launch:${launchIdOf(1)}:year`,
          deadlineAt: new Date('2027-05-25T07:35:00.000Z'),
          acceptUntil: new Date('2027-05-25T07:00:00.000Z'),
          fulfillableUntil: new Date('2027-05-25T07:45:00.000Z'),
          summary: {
            itemName: 'Yearトーナメント参加費',
            quantityLabel: '1件(2027年のYearトーナメント)',
            serviceTiming:
              '決済の反映後ただちに参加資格を付与し、2027年5月24日23:45(UTC-08:00)に組み合わせを決定します。決勝は2027年5月30日(日)です',
            additionalNotes: [
              '組み合わせ決定前にプロダクトを削除・退会すると参加資格を失い、参加費は自動で全額返金されます',
              'トーナメントの不戦勝・不戦敗・両者敗北による返金はありません',
              '決勝実施日は変更期限(決勝の7日前)まで変わることがあり、変更後の日程で行います',
            ],
          },
          requiresBotVerification: false,
        },
      });
      expect(queries).toStrictEqual([
        { userId: userIdOf(OWNER), from: AWARDED_AT, to: NOW },
      ]);
    });

    test('行の無い年でも照会は年の行を作らない', async () => {
      await seedEntry(1);
      const { policy } = createPolicy();

      expect((await describeAs(policy)).kind).toBe('available');
      expect(await countYearRows()).toBe(0);
    });

    test('期限と決勝日は年の行に保存した日程を使う', async () => {
      await insertYearTournaments([
        {
          index: 1,
          columns: {
            finalDate: EXPLICIT_SCHEDULE.finalDate,
            deadlineDate: EXPLICIT_SCHEDULE.deadlineDate,
            acceptUntil: EXPLICIT_SCHEDULE.acceptUntil,
            deadlineAt: EXPLICIT_SCHEDULE.deadlineAt,
            drawAt: EXPLICIT_SCHEDULE.drawAt,
            changeLockAt: EXPLICIT_SCHEDULE.changeLockAt,
            finalDateSource: 'explicit',
            finalDateVersion: 1,
            finalDateUpdatedAt: T0,
            finalDateUpdatedByAdminId: ADMIN_ID,
          },
        },
      ]);
      await seedEntry(1);
      const { policy } = createPolicy();

      const offer = offerOf(await describeAs(policy));

      expect(offer).toMatchObject({
        acceptUntil: new Date('2027-05-11T07:00:00.000Z'),
        deadlineAt: new Date('2027-05-11T07:35:00.000Z'),
        fulfillableUntil: new Date('2027-05-11T07:45:00.000Z'),
      });
      expect(offer.summary.serviceTiming).toBe(
        '決済の反映後ただちに参加資格を付与し、2027年5月10日23:45(UTC-08:00)に組み合わせを決定します。決勝は2027年5月16日(日)です',
      );
      expect(await countYearRows()).toBe(1);
    });

    test('受付期限の後も購入の内容を返し、受付の可否は決済の機能に任せる', async () => {
      await seedEntry(1);
      const { policy } = createPolicy();

      const decision = await describeAs(policy, {
        now: YEAR_SCHEDULE.acceptUntil,
      });

      expect(decision.kind).toBe('available');
    });
  });
});
