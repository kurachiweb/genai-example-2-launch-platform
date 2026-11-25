import { beforeEach, describe, expect, test } from 'vitest';

import type {
  PurchaseOffer,
  PurchaseOfferDecision,
} from '../../core/payments/purchase-kind-contract.ts';
import {
  SPONSORSHIP_OFFER_REJECTION_MESSAGES,
  type SponsorshipOfferRejectionCode,
} from '../../core/sponsorship/offer-rejection.ts';
import { D1ProductDirectory } from '../product/d1-product-directory.ts';
import { D1LaunchExport } from '../product/d1-product-export.ts';
import { D1EligibleProductReader } from './d1-eligible-product-reader.ts';
import { D1SponsorshipStore } from './d1-sponsorship-store.ts';
import { SponsorshipOfferPolicy } from './sponsorship-offer-policy.ts';
import {
  clearSponsorshipTables,
  createSequentialSponsorshipIds,
  db,
  insertSponsorProduct,
  insertSponsorships,
  insertSponsorUser,
  NOW,
  paidColumnsOf,
  type SponsorshipFixture,
  sponsorshipIdOf,
  T0,
  terminatedColumnsOf,
  userIdOf,
} from './testing/sponsorship-fixtures.ts';

const OWNER = 1;
const OTHER_USER = 2;

const PURCHASE_CONDITIONS = [
  '掲載期間はUTC-08:00の日付で区切り、開始日の0:00から終了日の翌日の0:00まで掲載します。',
  'プロダクトの公開停止やアカウントの停止で表示を止めても掲載期間は延長されませんが、表示を止めた日数分(1日のうち一部でも止めた日を含みます)と、運営者が掲載を強制終了した場合の未掲載の日数分は、掲載期間が終わった時点(強制終了ではその時点)に日割りで自動で返金します。',
  'プロダクトの削除や退会で掲載が終わった場合は、表示を止めた日数分を含めて返金されません。',
];

const policy = new SponsorshipOfferPolicy(
  new D1SponsorshipStore(db, createSequentialSponsorshipIds()),
  new D1EligibleProductReader(
    new D1LaunchExport(db),
    new D1ProductDirectory(db),
  ),
);

function describeAs(
  input: {
    readonly user?: number;
    readonly sponsorship?: number | null;
    readonly now?: Date;
  } = {},
): Promise<PurchaseOfferDecision> {
  const sponsorship = input.sponsorship === undefined ? 1 : input.sponsorship;
  return policy.describe({
    userId: userIdOf(input.user ?? OWNER),
    targetId: sponsorship === null ? null : sponsorshipIdOf(sponsorship),
    now: input.now ?? NOW,
  });
}

function rejectionOf(
  code: SponsorshipOfferRejectionCode,
): PurchaseOfferDecision {
  return {
    kind: 'unavailable',
    code,
    message: SPONSORSHIP_OFFER_REJECTION_MESSAGES[code],
  };
}

function offerOf(decision: PurchaseOfferDecision): PurchaseOffer {
  if (decision.kind !== 'available') {
    throw new Error(`購入を受け付けませんでした: ${decision.code}`);
  }
  return decision.offer;
}

// 申込1(投稿者1・プロダクト1)の列を指定して作る
async function seedSponsorship(
  columns: SponsorshipFixture['columns'] = {},
  product = 1,
): Promise<void> {
  await insertSponsorships([{ index: 1, owner: OWNER, product, columns }]);
}

beforeEach(async () => {
  await clearSponsorshipTables();
  await insertSponsorUser(OWNER);
  await insertSponsorUser(OTHER_USER);
  await insertSponsorProduct({ index: 1, owner: OWNER });
});

describe('SponsorshipOfferPolicy', () => {
  describe('決済できない申込(sponsorship_not_payable)', () => {
    test('対象の申込が指定されなければ拒否する', async () => {
      await seedSponsorship();

      expect(await describeAs({ sponsorship: null })).toStrictEqual(
        rejectionOf('sponsorship_not_payable'),
      );
    });

    test('存在しない申込は拒否する', async () => {
      await seedSponsorship();

      expect(await describeAs({ sponsorship: 2 })).toStrictEqual(
        rejectionOf('sponsorship_not_payable'),
      );
    });

    test('論理削除された申込は拒否する', async () => {
      await seedSponsorship({ deletedAt: T0 });

      expect(await describeAs()).toStrictEqual(
        rejectionOf('sponsorship_not_payable'),
      );
    });

    test('申込者以外の決済の開始は拒否する', async () => {
      await seedSponsorship();

      expect(await describeAs({ user: OTHER_USER })).toStrictEqual(
        rejectionOf('sponsorship_not_payable'),
      );
    });

    test.each([
      { state: 'paid', columns: paidColumnsOf(1) },
      { state: 'terminated', columns: terminatedColumnsOf(1) },
    ])('$stateの申込は拒否する', async ({ columns }) => {
      await seedSponsorship(columns);

      expect(await describeAs()).toStrictEqual(
        rejectionOf('sponsorship_not_payable'),
      );
    });

    test('開始日が今日より前の申込は拒否する', async () => {
      await seedSponsorship({
        startsOn: '2026-11-24',
        endsOn: '2026-11-30',
        days: 7,
      });

      expect(await describeAs()).toStrictEqual(
        rejectionOf('sponsorship_not_payable'),
      );
    });

    test('開始日の判定は基準時刻(UTC-08:00)の日付で行い、開始日の翌日0:00の直前まで受け付ける', async () => {
      await seedSponsorship({
        startsOn: '2026-11-24',
        endsOn: '2026-11-30',
        days: 7,
      });

      const decision = await describeAs({
        now: new Date(NOW.getTime() - 1),
      });

      expect(decision.kind).toBe('available');
    });

    test('開始日が今日の申込は受け付ける', async () => {
      await seedSponsorship({
        startsOn: '2026-11-25',
        endsOn: '2026-11-25',
        days: 1,
      });

      expect((await describeAs()).kind).toBe('available');
    });
  });

  describe('掲載期間の誤り(sponsorship_period_invalid)', () => {
    test.each([
      {
        case: '開始日が今日から365日後より後',
        columns: { startsOn: '2027-11-26', endsOn: '2027-11-26', days: 1 },
      },
      {
        case: '終了日が開始日より前',
        columns: { startsOn: '2026-12-07', endsOn: '2026-12-01', days: 1 },
      },
      {
        case: '期間が366日を超える',
        columns: { startsOn: '2026-12-01', endsOn: '2027-12-02', days: 366 },
      },
    ])('$caseなら拒否する', async ({ columns }) => {
      await seedSponsorship(columns);

      expect(await describeAs()).toStrictEqual(
        rejectionOf('sponsorship_period_invalid'),
      );
    });

    test('開始日が今日から365日後で期間が366日なら受け付ける', async () => {
      await seedSponsorship({
        startsOn: '2027-11-25',
        endsOn: '2028-11-24',
        days: 366,
      });

      expect(offerOf(await describeAs()).quantity).toBe(366);
    });

    test('開始日の判定を先に行う', async () => {
      await seedSponsorship({
        startsOn: '2026-11-24',
        endsOn: '2026-11-20',
        days: 1,
      });

      expect(await describeAs()).toStrictEqual(
        rejectionOf('sponsorship_not_payable'),
      );
    });
  });

  describe('申込の対象でないプロダクト(sponsorship_product_ineligible)', () => {
    test.each([
      {
        case: '非公開化されたプロダクト',
        product: { index: 2, owner: OWNER, state: 'hidden' },
      },
      {
        case: 'キックオフ前のローンチだけのプロダクト',
        product: { index: 2, owner: OWNER, launches: ['before_kickoff'] },
      },
      {
        case: '取り消されたローンチだけのプロダクト',
        product: { index: 2, owner: OWNER, launches: ['canceled'] },
      },
      {
        case: '他人のプロダクト',
        product: { index: 2, owner: OTHER_USER },
      },
    ] as const)('$caseの申込は拒否する', async ({ product }) => {
      await insertSponsorProduct(product);
      await seedSponsorship({}, 2);

      expect(await describeAs()).toStrictEqual(
        rejectionOf('sponsorship_product_ineligible'),
      );
    });

    test('掲載期間の判定を先に行う', async () => {
      await insertSponsorProduct({ index: 2, owner: OWNER, state: 'hidden' });
      await seedSponsorship(
        { startsOn: '2026-12-07', endsOn: '2026-12-01', days: 1 },
        2,
      );

      expect(await describeAs()).toStrictEqual(
        rejectionOf('sponsorship_period_invalid'),
      );
    });

    test('マッチ中のローンチのプロダクトは受け付ける', async () => {
      await insertSponsorProduct({
        index: 2,
        owner: OWNER,
        launches: ['in_progress'],
      });
      await seedSponsorship({}, 2);

      expect((await describeAs()).kind).toBe('available');
    });
  });

  describe('掲載期間の重なり(sponsorship_overlap)', () => {
    async function seedOther(
      columns: SponsorshipFixture['columns'],
    ): Promise<void> {
      await insertSponsorships([
        { index: 2, owner: OWNER, product: 1, columns },
      ]);
    }

    test('同じプロダクト・同じティアの決済済みの申込と1日でも重なれば拒否する', async () => {
      await seedSponsorship();
      await seedOther(
        paidColumnsOf(2, {
          startsOn: '2026-12-07',
          endsOn: '2026-12-10',
          days: 4,
        }),
      );

      expect(await describeAs()).toStrictEqual(
        rejectionOf('sponsorship_overlap'),
      );
    });

    test.each([
      {
        case: '終了日の翌日に始まる決済済みの申込',
        columns: paidColumnsOf(2, {
          startsOn: '2026-12-08',
          endsOn: '2026-12-10',
          days: 3,
        }),
      },
      {
        case: '異なるティアの決済済みの申込',
        columns: paidColumnsOf(2, { tier: 'legend' }),
      },
      { case: '未決済の申込', columns: {} },
      { case: '強制終了された申込', columns: terminatedColumnsOf(2) },
    ])('$caseとは重ならない', async ({ columns }) => {
      await seedSponsorship();
      await seedOther(columns);

      expect((await describeAs()).kind).toBe('available');
    });

    test('申込の対象の判定を先に行う', async () => {
      await insertSponsorProduct({ index: 2, owner: OWNER, state: 'hidden' });
      await seedSponsorship({}, 2);
      await insertSponsorships([
        { index: 2, owner: OWNER, product: 2, columns: paidColumnsOf(2) },
      ]);

      expect(await describeAs()).toStrictEqual(
        rejectionOf('sponsorship_product_ineligible'),
      );
    });
  });

  describe('購入の内容', () => {
    test('数量を日数、反映の期限を掲載開始日の翌日0:00の直前、二重決済の鍵を申込ごとにし、決済画面の表示事項を渡す', async () => {
      await seedSponsorship();

      expect(await describeAs()).toStrictEqual({
        kind: 'available',
        offer: {
          priceLookupKey: 'sponsorship_gold_daily',
          quantity: 7,
          relatedId: sponsorshipIdOf(1),
          exclusivityKey: `sponsorship:${sponsorshipIdOf(1)}`,
          deadlineAt: null,
          acceptUntil: null,
          fulfillableUntil: new Date('2026-12-02T07:59:59.999Z'),
          summary: {
            itemName: 'スポンサー広告(Gold)',
            quantityLabel: '7日間(2026年12月1日〜12月7日)',
            serviceTiming:
              '選んだ掲載期間(2026年12月1日〜12月7日、UTC-08:00の日付)',
            additionalNotes: PURCHASE_CONDITIONS,
          },
          requiresBotVerification: false,
        },
      });
    });

    test('年をまたぐ掲載期間は終了日に年を付け、ティアの価格と表示名を使う', async () => {
      await seedSponsorship({
        tier: 'legend',
        startsOn: '2026-12-28',
        endsOn: '2027-01-03',
        days: 7,
      });

      const offer = offerOf(await describeAs());

      expect(offer.priceLookupKey).toBe('sponsorship_legend_daily');
      expect(offer.fulfillableUntil).toStrictEqual(
        new Date('2026-12-29T07:59:59.999Z'),
      );
      expect(offer.summary).toStrictEqual({
        itemName: 'スポンサー広告(Legend)',
        quantityLabel: '7日間(2026年12月28日〜2027年1月3日)',
        serviceTiming:
          '選んだ掲載期間(2026年12月28日〜2027年1月3日、UTC-08:00の日付)',
        additionalNotes: PURCHASE_CONDITIONS,
      });
    });

    test('1日の掲載期間とSilverの表示事項を渡す', async () => {
      await seedSponsorship({
        tier: 'silver',
        startsOn: '2026-12-01',
        endsOn: '2026-12-01',
        days: 1,
      });

      const offer = offerOf(await describeAs());

      expect(offer.priceLookupKey).toBe('sponsorship_silver_daily');
      expect(offer.quantity).toBe(1);
      expect(offer.summary.itemName).toBe('スポンサー広告(Silver)');
      expect(offer.summary.quantityLabel).toBe('1日間(2026年12月1日〜12月1日)');
    });
  });
});
