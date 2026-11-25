import { describe, expect, test } from 'vitest';

import { StripeUnavailableError } from '../../../../../lib/core/payments/ports.ts';
import { SPONSORSHIP_OFFER_REJECTION_MESSAGES } from '../../../../../lib/core/sponsorship/offer-rejection.ts';
import {
  fileIdOf,
  insertFile,
} from '../../../../../lib/workers/media/testing/media-file-store-fixtures.ts';
import {
  insertSponsorProduct,
  insertSponsorships,
  insertSponsorUser,
  paidColumnsOf,
  productIdOf,
  sponsorshipIdOf,
  terminatedColumnsOf,
  userIdOf,
} from '../../../../../lib/workers/sponsorship/testing/sponsorship-fixtures.ts';
import {
  codesOf,
  detailsOf,
  fetchActiveSponsorshipCount,
  fetchPeriodWindow,
  fetchSponsoredPlacements,
  fetchSponsorshipOffer,
  installSponsorshipGraphQLTest,
  issueSponsorshipSession,
  NEXT_DAY_STARTS_AT,
  SPONSORSHIP_PRICES,
  updateSponsorProduct,
  useStripe,
} from '../../../../../test/support/sponsorship-graphql-operations.ts';

installSponsorshipGraphQLTest();

const OWNER = 1;

const OTHER_USER = 2;

const PRODUCT = 1;

const OTHER_PRODUCT = 2;

const START_OUT_OF_RANGE_MESSAGE =
  '開始日は今日から1年以内の日付を選んでください。';

const useSponsorshipPrices = () =>
  useStripe({ resolvePrices: () => Promise.resolve(SPONSORSHIP_PRICES) });

// 投稿者1の申込の対象のプロダクト1(配信できるロゴ)と、利用者2の申込の対象のプロダクト2を作る
async function seedProducts(): Promise<void> {
  await insertSponsorUser(OWNER);
  await insertSponsorUser(OTHER_USER);
  await insertFile(1, { ownerId: userIdOf(OWNER) });
  await insertSponsorProduct({ index: PRODUCT, owner: OWNER });
  await updateSponsorProduct(PRODUCT, { logoFileId: fileIdOf(1) });
  await insertSponsorProduct({ index: OTHER_PRODUCT, owner: OTHER_USER });
}

describe('呼び出し元の確認', () => {
  test.each([
    ['sponsorshipOffer', () => fetchSponsorshipOffer({ caller: 'admin' })],
    [
      'sponsorshipPeriodWindow',
      () =>
        fetchPeriodWindow(
          { productId: productIdOf(PRODUCT), tier: 'GOLD' },
          { caller: 'admin' },
        ),
    ],
    [
      'sponsoredPlacements',
      () => fetchSponsoredPlacements({ caller: 'admin' }),
    ],
    [
      'activeSponsorshipCount',
      () => fetchActiveSponsorshipCount('product1', { caller: 'admin' }),
    ],
  ])(
    '管理者側の呼び出し元からの%sはforbiddenで拒否する',
    async (_name, call) => {
      await seedProducts();

      const response = await call();

      expect(codesOf(response)).toEqual(['forbidden']);
    },
  );
});

describe('sponsorshipOffer', () => {
  test('未ログインでも3つのティアの1日あたりの税込の価格を返し、申込の対象はnullにする', async () => {
    await seedProducts();
    useSponsorshipPrices();

    const response = await fetchSponsorshipOffer();

    expect(response.errors).toBeUndefined();
    expect(response.data?.sponsorshipOffer).toEqual({
      tiers: [
        { tier: 'LEGEND', unitPrice: { amount: 3000, currency: 'usd' } },
        { tier: 'GOLD', unitPrice: { amount: 1000, currency: 'usd' } },
        { tier: 'SILVER', unitPrice: { amount: 300, currency: 'usd' } },
      ],
      eligibleProducts: null,
    });
  });

  test('ログイン中は自分の申込の対象のプロダクトだけを名称とロゴで返す', async () => {
    await seedProducts();
    useSponsorshipPrices();
    const sessionToken = await issueSponsorshipSession(OWNER);

    const response = await fetchSponsorshipOffer({ sessionToken });

    expect(response.errors).toBeUndefined();
    expect(response.data?.sponsorshipOffer?.eligibleProducts).toEqual([
      {
        id: productIdOf(PRODUCT),
        handle: 'product1',
        name: 'プロダクト1',
        logo: { id: fileIdOf(1) },
      },
    ]);
  });

  test('決済サービスに到達できなければ、単価を全てnullにしてエラーにしない', async () => {
    await seedProducts();
    useStripe({
      resolvePrices: () =>
        Promise.reject(new StripeUnavailableError('Stripeに接続できません')),
    });

    const response = await fetchSponsorshipOffer();

    expect(response.errors).toBeUndefined();
    expect(response.data?.sponsorshipOffer?.tiers).toEqual([
      { tier: 'LEGEND', unitPrice: null },
      { tier: 'GOLD', unitPrice: null },
      { tier: 'SILVER', unitPrice: null },
    ]);
  });
});

describe('sponsorshipPeriodWindow', () => {
  // 同じプロダクト・同じティアの決済済み(12-01〜12-07)だけが重なりになる。強制終了・未決済・他のティア・プロダクトの論理削除の記録・他のプロダクトの申込は含めない
  async function seedPeriods(): Promise<void> {
    await seedProducts();
    await insertSponsorships([
      { index: 1, owner: OWNER, product: PRODUCT, columns: paidColumnsOf(1) },
      {
        index: 2,
        owner: OWNER,
        product: PRODUCT,
        columns: terminatedColumnsOf(2, {
          startsOn: '2026-12-10',
          endsOn: '2026-12-12',
          days: 3,
        }),
      },
      {
        index: 3,
        owner: OWNER,
        product: PRODUCT,
        columns: { startsOn: '2026-12-15', endsOn: '2026-12-16', days: 2 },
      },
      {
        index: 4,
        owner: OWNER,
        product: PRODUCT,
        columns: paidColumnsOf(4, {
          tier: 'silver',
          startsOn: '2026-12-20',
          endsOn: '2026-12-21',
          days: 2,
        }),
      },
      {
        index: 5,
        owner: OWNER,
        product: PRODUCT,
        columns: paidColumnsOf(5, {
          startsOn: '2026-12-25',
          endsOn: '2026-12-26',
          days: 2,
          productDeletedAt: new Date('2026-11-20T00:00:00.000Z'),
        }),
      },
      {
        index: 6,
        owner: OTHER_USER,
        product: OTHER_PRODUCT,
        columns: paidColumnsOf(6, {
          startsOn: '2026-12-28',
          endsOn: '2026-12-29',
          days: 2,
        }),
      },
    ]);
  }

  test('開始日を渡さなければ、開始日の選べる範囲と次の0:00の時点を返し、終了日の範囲はnullにする', async () => {
    await seedPeriods();
    const sessionToken = await issueSponsorshipSession(OWNER);

    const response = await fetchPeriodWindow(
      { productId: productIdOf(PRODUCT), tier: 'GOLD' },
      { sessionToken },
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.sponsorshipPeriodWindow).toEqual({
      businessToday: '2026-11-25',
      nextDayStartsAt: NEXT_DAY_STARTS_AT,
      start: {
        earliest: '2026-11-25',
        latest: '2027-11-25',
        unavailable: [
          { from: '2026-12-01', to: '2026-12-07', reason: 'OVERLAP' },
        ],
      },
      end: null,
    });
  });

  test('選べる開始日を渡すと、次の決済済みの期間の前日までを終了日の範囲にする', async () => {
    await seedPeriods();
    const sessionToken = await issueSponsorshipSession(OWNER);

    const response = await fetchPeriodWindow(
      { productId: productIdOf(PRODUCT), tier: 'GOLD', startsOn: '2026-11-26' },
      { sessionToken },
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.sponsorshipPeriodWindow?.end).toEqual({
      earliest: '2026-11-26',
      latest: '2026-11-30',
      unavailable: [
        { from: '2026-12-01', to: '2027-11-26', reason: 'OVERLAP' },
      ],
    });
  });

  test('重なりで選べない開始日を渡しても、エラーにせず終了日の範囲をnullにする', async () => {
    await seedPeriods();
    const sessionToken = await issueSponsorshipSession(OWNER);

    const response = await fetchPeriodWindow(
      { productId: productIdOf(PRODUCT), tier: 'GOLD', startsOn: '2026-12-03' },
      { sessionToken },
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.sponsorshipPeriodWindow?.end).toBeNull();
  });

  test('他のティアの選べる範囲には、そのティアの決済済みの期間だけが重なりになる', async () => {
    await seedPeriods();
    const sessionToken = await issueSponsorshipSession(OWNER);

    const response = await fetchPeriodWindow(
      { productId: productIdOf(PRODUCT), tier: 'SILVER' },
      { sessionToken },
    );

    expect(response.data?.sponsorshipPeriodWindow?.start.unavailable).toEqual([
      { from: '2026-12-20', to: '2026-12-21', reason: 'OVERLAP' },
    ]);
  });

  test('形式の違う開始日はvalidation_errorで拒否する', async () => {
    await seedPeriods();
    const sessionToken = await issueSponsorshipSession(OWNER);

    const response = await fetchPeriodWindow(
      { productId: productIdOf(PRODUCT), tier: 'GOLD', startsOn: '2026-02-30' },
      { sessionToken },
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      {
        field: 'startsOn',
        code: 'invalid',
        message: START_OUT_OF_RANGE_MESSAGE,
      },
    ]);
  });

  test('他人のプロダクトはsponsorship_product_ineligibleで拒否し、掲載期間を返さない', async () => {
    await seedPeriods();
    const sessionToken = await issueSponsorshipSession(OWNER);

    const response = await fetchPeriodWindow(
      { productId: productIdOf(OTHER_PRODUCT), tier: 'GOLD' },
      { sessionToken },
    );

    expect(codesOf(response)).toEqual(['sponsorship_product_ineligible']);
    expect(response.errors?.[0]?.message).toBe(
      SPONSORSHIP_OFFER_REJECTION_MESSAGES.sponsorship_product_ineligible,
    );
    expect(response.data).toBeNull();
  });

  test('形式の違うプロダクトのIDは、対象外と同じ文言のvalidation_errorで拒否する', async () => {
    await seedPeriods();
    const sessionToken = await issueSponsorshipSession(OWNER);

    const response = await fetchPeriodWindow(
      { productId: 'not-a-product-id', tier: 'GOLD' },
      { sessionToken },
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      {
        field: 'productId',
        code: expect.any(String) as string,
        message:
          SPONSORSHIP_OFFER_REJECTION_MESSAGES.sponsorship_product_ineligible,
      },
    ]);
  });

  test('ログインしていなければunauthenticatedで拒否する', async () => {
    await seedPeriods();

    const response = await fetchPeriodWindow({
      productId: productIdOf(PRODUCT),
      tier: 'GOLD',
    });

    expect(codesOf(response)).toEqual(['unauthenticated']);
  });
});

describe('sponsoredPlacements', () => {
  const PLACED_PERIOD = Object.freeze({
    startsOn: '2026-11-20',
    endsOn: '2026-11-30',
    days: 11,
  });

  // 1: Legend(配信できるロゴ) / 2: Gold(検証を通らない外部WebサイトURL) / 3: Silver / 4: 未決済のLegend
  async function seedPlacements(): Promise<void> {
    await insertSponsorUser(OWNER);
    await insertFile(1, { ownerId: userIdOf(OWNER) });
    for (const index of [1, 2, 3, 4]) {
      await insertSponsorProduct({ index, owner: OWNER });
    }
    await updateSponsorProduct(1, { logoFileId: fileIdOf(1) });
    await updateSponsorProduct(2, { websiteUrl: 'javascript:alert(1)' });
    await insertSponsorships([
      {
        index: 1,
        owner: OWNER,
        product: 1,
        columns: paidColumnsOf(1, { tier: 'legend', ...PLACED_PERIOD }),
      },
      {
        index: 2,
        owner: OWNER,
        product: 2,
        columns: paidColumnsOf(2, { tier: 'gold', ...PLACED_PERIOD }),
      },
      {
        index: 3,
        owner: OWNER,
        product: 3,
        columns: paidColumnsOf(3, { tier: 'silver', ...PLACED_PERIOD }),
      },
      {
        index: 4,
        owner: OWNER,
        product: 4,
        columns: { tier: 'legend', ...PLACED_PERIOD },
      },
    ]);
  }

  test('未ログインでも掲載中の広告をティアごとに返し、Silverのタグラインと検証を通らない外部WebサイトURLを空にする', async () => {
    await seedPlacements();

    const response = await fetchSponsoredPlacements();

    expect(response.errors).toBeUndefined();
    expect(response.data?.sponsoredPlacements).toEqual({
      legend: [
        {
          id: sponsorshipIdOf(1),
          tier: 'LEGEND',
          productName: 'プロダクト1',
          tagline: 'タグライン1',
          logo: { id: fileIdOf(1) },
          websiteUrl: 'https://product1.example/',
        },
      ],
      gold: [
        {
          id: sponsorshipIdOf(2),
          tier: 'GOLD',
          productName: 'プロダクト2',
          tagline: 'タグライン2',
          logo: null,
          websiteUrl: null,
        },
      ],
      silver: [
        {
          id: sponsorshipIdOf(3),
          tier: 'SILVER',
          productName: 'プロダクト3',
          tagline: null,
          logo: null,
          websiteUrl: 'https://product3.example/',
        },
      ],
    });
  });
});

describe('activeSponsorshipCount', () => {
  // 決済済みの掲載中(1)と掲載予定(2)、終了(3)、未決済(4)
  async function seedActive(): Promise<void> {
    await seedProducts();
    await insertSponsorships([
      {
        index: 1,
        owner: OWNER,
        product: PRODUCT,
        columns: paidColumnsOf(1, {
          startsOn: '2026-11-20',
          endsOn: '2026-11-30',
          days: 11,
        }),
      },
      { index: 2, owner: OWNER, product: PRODUCT, columns: paidColumnsOf(2) },
      {
        index: 3,
        owner: OWNER,
        product: PRODUCT,
        columns: paidColumnsOf(3, {
          startsOn: '2026-11-01',
          endsOn: '2026-11-10',
          days: 10,
        }),
      },
      { index: 4, owner: OWNER, product: PRODUCT },
    ]);
  }

  test('本人のプロダクトの掲載中・掲載予定の広告の件数を返す', async () => {
    await seedActive();
    const sessionToken = await issueSponsorshipSession(OWNER);

    const response = await fetchActiveSponsorshipCount('product1', {
      sessionToken,
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.activeSponsorshipCount).toBe(2);
  });

  test('本人以外のプロダクトは0を返す', async () => {
    await seedActive();
    const sessionToken = await issueSponsorshipSession(OTHER_USER);

    const response = await fetchActiveSponsorshipCount('product1', {
      sessionToken,
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.activeSponsorshipCount).toBe(0);
  });

  test('ログインしていなければunauthenticatedで拒否する', async () => {
    await seedActive();

    const response = await fetchActiveSponsorshipCount('product1');

    expect(codesOf(response)).toEqual(['unauthenticated']);
  });
});
