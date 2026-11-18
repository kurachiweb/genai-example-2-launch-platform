import { describe, expect, test } from 'vitest';

import {
  insertSponsorProduct,
  insertSponsorships,
  insertSponsorUser,
  paidColumnsOf,
  sponsorshipIdOf,
  sponsorshipPurchaseIdOf,
  type SponsorshipFixture,
  T0,
  terminatedColumnsOf,
} from '../../../../../lib/workers/sponsorship/testing/sponsorship-fixtures.ts';
import {
  type AdminSponsorshipFields,
  asSponsorshipAdmin,
  codesOf,
  detailsOf,
  fetchAdminSponsorships,
  installSponsorshipAdminGraphQLTest,
  SPONSORSHIP_ADMINS,
} from '../../../../../test/support/sponsorship-admin-graphql-operations.ts';

installSponsorshipAdminGraphQLTest();

const OWNER = 1;

const OTHER_USER = 2;

const VISIBLE = 1;

const HIDDEN = 2;

const DELETED = 3;

const OTHERS_PRODUCT = 4;

const PAGE_SIZE_MESSAGE = '表示する件数は1〜50件の整数で指定してください。';

const IN_PERIOD = Object.freeze({
  startsOn: '2026-11-20',
  endsOn: '2026-11-30',
  days: 11,
});

const PAST_PERIOD = Object.freeze({
  startsOn: '2026-11-01',
  endsOn: '2026-11-10',
  days: 10,
});

const USD = (amount: number) => ({ amount, currency: 'usd' });

// 作成の新しい順に並ぶよう、番号の大きい申込ほど後に作る
function createdAtOf(index: number): Date {
  return new Date(Date.UTC(2026, 10, 20, 0, index));
}

function fixtureOf(
  index: number,
  product: number,
  columns: SponsorshipFixture['columns'] = {},
): SponsorshipFixture {
  return {
    index,
    owner: product === OTHERS_PRODUCT ? OTHER_USER : OWNER,
    product,
    columns: { createdAt: createdAtOf(index), ...columns },
  };
}

// 1: 未決済 / 2: 掲載中 / 3: 非公開化中のプロダクトの表示停止 / 4: 論理削除済みのプロダクト / 5: 他人の強制終了済み / 6: 終了 / 7: 退会で論理削除した申込
async function seedSponsorships(): Promise<void> {
  await insertSponsorUser(OWNER);
  await insertSponsorUser(OTHER_USER);
  await insertSponsorProduct({ index: VISIBLE, owner: OWNER });
  await insertSponsorProduct({ index: HIDDEN, owner: OWNER, state: 'hidden' });
  await insertSponsorProduct({
    index: DELETED,
    owner: OWNER,
    state: 'deleted',
  });
  await insertSponsorProduct({ index: OTHERS_PRODUCT, owner: OTHER_USER });
  await insertSponsorships([
    fixtureOf(1, VISIBLE),
    fixtureOf(2, VISIBLE, paidColumnsOf(2, { ...IN_PERIOD, tier: 'legend' })),
    fixtureOf(3, HIDDEN, paidColumnsOf(3, { ...IN_PERIOD, tier: 'silver' })),
    fixtureOf(4, DELETED, paidColumnsOf(4, { productDeletedAt: T0 })),
    fixtureOf(5, OTHERS_PRODUCT, terminatedColumnsOf(5, IN_PERIOD)),
    fixtureOf(6, VISIBLE, paidColumnsOf(6, PAST_PERIOD)),
    fixtureOf(7, VISIBLE, paidColumnsOf(7, { ...IN_PERIOD, deletedAt: T0 })),
  ]);
}

const BASE_NODE = Object.freeze({
  productName: 'プロダクト1',
  productHandle: 'product1',
  productDeleted: false,
  applicantNickname: '利用者1',
  tier: 'GOLD',
  startsOn: '2026-12-01',
  endsOn: '2026-12-07',
  days: 7,
  amountPaid: USD(7_000),
  terminable: false,
});

function nodeOf(
  index: number,
  fields: Partial<AdminSponsorshipFields>,
): AdminSponsorshipFields {
  return {
    ...BASE_NODE,
    id: sponsorshipIdOf(index),
    status: 'SCHEDULED',
    purchaseId: sponsorshipPurchaseIdOf(index),
    createdAt: createdAtOf(index).toISOString(),
    ...fields,
  };
}

const NODES = Object.freeze({
  pendingPayment: nodeOf(1, {
    amountPaid: null,
    status: 'PENDING_PAYMENT',
    purchaseId: null,
  }),
  active: nodeOf(2, {
    ...IN_PERIOD,
    tier: 'LEGEND',
    status: 'ACTIVE',
    terminable: true,
  }),
  paused: nodeOf(3, {
    ...IN_PERIOD,
    productName: 'プロダクト2',
    productHandle: 'product2',
    tier: 'SILVER',
    status: 'PAUSED',
    terminable: true,
  }),
  productDeleted: nodeOf(4, {
    productName: null,
    productHandle: null,
    productDeleted: true,
    status: 'ENDED',
  }),
  terminated: nodeOf(5, {
    ...IN_PERIOD,
    productName: 'プロダクト4',
    productHandle: 'product4',
    applicantNickname: '利用者2',
    status: 'TERMINATED',
  }),
  ended: nodeOf(6, { ...PAST_PERIOD, status: 'ENDED' }),
});

describe('adminSponsorships 呼び出し元とロール', () => {
  test('利用者側の呼び出し元からはforbiddenで拒否する', async () => {
    await seedSponsorships();

    const response = await fetchAdminSponsorships({ first: 50 });

    expect(codesOf(response)).toEqual(['forbidden']);
    expect(response.data?.adminSponsorships).toBeUndefined();
  });

  test('管理者のセッションが無ければunauthenticatedで拒否する', async () => {
    const response = await fetchAdminSponsorships(
      { first: 50 },
      { caller: 'admin' },
    );

    expect(codesOf(response)).toEqual(['unauthenticated']);
  });

  test.each([
    ['閲覧のみの管理者', SPONSORSHIP_ADMINS.viewer],
    ['モデレーター', SPONSORSHIP_ADMINS.moderator],
    ['最上位管理者', SPONSORSHIP_ADMINS.superAdmin],
  ])('%sに一覧を返す', async (_label, admin) => {
    await seedSponsorships();

    const response = await fetchAdminSponsorships(
      { first: 50 },
      asSponsorshipAdmin(admin),
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.adminSponsorships?.nodes).toHaveLength(6);
  });
});

describe('adminSponsorships 一覧の内容', () => {
  test('退会で論理削除した申込を除く全ての申込を申込の新しい順に、プロダクト・申込者・期間・金額・掲載状況・強制終了の可否・購入の識別とともに返す', async () => {
    await seedSponsorships();

    const response = await fetchAdminSponsorships(
      { first: 50 },
      asSponsorshipAdmin(SPONSORSHIP_ADMINS.viewer),
    );

    expect(response.data?.adminSponsorships?.nodes).toEqual([
      NODES.ended,
      NODES.terminated,
      NODES.productDeleted,
      NODES.paused,
      NODES.active,
      NODES.pendingPayment,
    ]);
    expect(response.data?.adminSponsorships?.pageInfo.hasNextPage).toBe(false);
  });

  test.each([
    ['PENDING_PAYMENT', [NODES.pendingPayment]],
    ['ACTIVE', [NODES.paused, NODES.active]],
    ['ENDED', [NODES.ended, NODES.productDeleted]],
    ['TERMINATED', [NODES.terminated]],
  ] as const)('掲載状況%sで絞り込める', async (status, expected) => {
    await seedSponsorships();

    const response = await fetchAdminSponsorships(
      { filter: { status }, first: 50 },
      asSponsorshipAdmin(SPONSORSHIP_ADMINS.viewer),
    );

    expect(response.data?.adminSponsorships?.nodes).toEqual(expected);
  });

  test('掲載予定とティアで絞り込める', async () => {
    await seedSponsorships();
    await insertSponsorships([
      fixtureOf(8, VISIBLE, paidColumnsOf(8, { tier: 'legend' })),
      fixtureOf(9, VISIBLE, paidColumnsOf(9)),
    ]);

    const scheduled = await fetchAdminSponsorships(
      { filter: { status: 'SCHEDULED' }, first: 50 },
      asSponsorshipAdmin(SPONSORSHIP_ADMINS.viewer),
    );
    const legend = await fetchAdminSponsorships(
      { filter: { tier: 'LEGEND', status: null }, first: 50 },
      asSponsorshipAdmin(SPONSORSHIP_ADMINS.viewer),
    );

    expect(
      scheduled.data?.adminSponsorships?.nodes.map(({ id }) => id),
    ).toEqual([sponsorshipIdOf(9), sponsorshipIdOf(8)]);
    expect(legend.data?.adminSponsorships?.nodes.map(({ id }) => id)).toEqual([
      sponsorshipIdOf(8),
      sponsorshipIdOf(2),
    ]);
  });

  test('前のページの最後の位置から続きのページを返す', async () => {
    await seedSponsorships();

    const first = await fetchAdminSponsorships(
      { first: 4 },
      asSponsorshipAdmin(SPONSORSHIP_ADMINS.viewer),
    );
    const next = await fetchAdminSponsorships(
      { first: 4, after: first.data?.adminSponsorships?.pageInfo.endCursor },
      asSponsorshipAdmin(SPONSORSHIP_ADMINS.viewer),
    );

    expect(first.data?.adminSponsorships?.pageInfo.hasNextPage).toBe(true);
    expect(next.data?.adminSponsorships?.nodes).toEqual([
      NODES.active,
      NODES.pendingPayment,
    ]);
    expect(next.data?.adminSponsorships?.pageInfo.hasNextPage).toBe(false);
  });

  test('申込が無ければ空のページを返す', async () => {
    const response = await fetchAdminSponsorships(
      { first: 50 },
      asSponsorshipAdmin(SPONSORSHIP_ADMINS.viewer),
    );

    expect(response.data?.adminSponsorships).toEqual({
      nodes: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
  });
});

describe('adminSponsorships 引数の検証', () => {
  test.each([
    [0, 'too_small'],
    [51, 'too_big'],
  ])('表示する件数%iはvalidation_errorで拒否する', async (first, code) => {
    const response = await fetchAdminSponsorships(
      { first },
      asSponsorshipAdmin(SPONSORSHIP_ADMINS.viewer),
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      {
        field: 'first',
        code,
        message: PAGE_SIZE_MESSAGE,
      },
    ]);
  });

  test('不正な位置はinvalid_cursorで拒否する', async () => {
    const response = await fetchAdminSponsorships(
      { first: 50, after: 'not-a-cursor' },
      asSponsorshipAdmin(SPONSORSHIP_ADMINS.viewer),
    );

    expect(codesOf(response)).toEqual(['invalid_cursor']);
  });
});
