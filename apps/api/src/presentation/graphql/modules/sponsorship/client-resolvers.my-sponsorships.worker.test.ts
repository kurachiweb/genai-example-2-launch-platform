import { describe, expect, test } from 'vitest';

import {
  fileIdOf,
  insertFile,
} from '../../../../../lib/workers/media/testing/media-file-store-fixtures.ts';
import {
  insertSponsorProduct,
  insertSponsorships,
  insertSponsorUser,
  paidColumnsOf,
  sponsorshipIdOf,
  type SponsorshipFixture,
  terminatedColumnsOf,
  userIdOf,
} from '../../../../../lib/workers/sponsorship/testing/sponsorship-fixtures.ts';
import {
  codesOf,
  detailsOf,
  fetchMySponsorships,
  installSponsorshipGraphQLTest,
  issueSponsorshipSession,
  type MySponsorshipFields,
  NEXT_DAY_STARTS_AT,
  updateSponsorProduct,
} from '../../../../../test/support/sponsorship-graphql-operations.ts';

installSponsorshipGraphQLTest();

const OWNER = 1;

const OTHER_USER = 2;

const VISIBLE = 1;

const HIDDEN = 2;

const DELETED = 3;

const OTHERS_PRODUCT = 4;

const PAGE_SIZE_MESSAGE = '表示する件数は1〜20件の整数で指定してください。';

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

// 業務日付2026-11-24の業務時刻12:00
const TERMINATED_AT = new Date('2026-11-24T20:00:00.000Z');

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

// 1: 表示中・配信できるロゴ / 2: 非公開化中 / 3: 論理削除済み / 4: 他人のプロダクト
async function seedProducts(): Promise<void> {
  await insertSponsorUser(OWNER);
  await insertSponsorUser(OTHER_USER);
  await insertFile(1, { ownerId: userIdOf(OWNER) });
  await insertSponsorProduct({ index: VISIBLE, owner: OWNER });
  await updateSponsorProduct(VISIBLE, { logoFileId: fileIdOf(1) });
  await insertSponsorProduct({ index: HIDDEN, owner: OWNER, state: 'hidden' });
  await insertSponsorProduct({
    index: DELETED,
    owner: OWNER,
    state: 'deleted',
  });
  await insertSponsorProduct({ index: OTHERS_PRODUCT, owner: OTHER_USER });
}

const VISIBLE_PRODUCT = Object.freeze({
  handle: 'product1',
  name: 'プロダクト1',
  logo: { id: fileIdOf(1) },
  listed: true,
});

const BASE_NODE = Object.freeze({
  product: VISIBLE_PRODUCT,
  tier: 'GOLD',
  startsOn: '2026-12-01',
  endsOn: '2026-12-07',
  days: 7,
  amountPaid: null,
  terminatedOn: null,
  terminationReason: null,
  terminationRefund: null,
  displayStopRefund: null,
  canResume: false,
});

function nodeOf(
  index: number,
  fields: Partial<MySponsorshipFields>,
): MySponsorshipFields {
  return {
    id: sponsorshipIdOf(index),
    ...BASE_NODE,
    status: 'PENDING_PAYMENT',
    createdAt: createdAtOf(index).toISOString(),
    ...fields,
  };
}

describe('mySponsorships', () => {
  test('本人の申込だけを新しい順に、掲載状況と金額と次の0:00の時点を添えて返す', async () => {
    await seedProducts();
    await insertSponsorships([
      fixtureOf(1, VISIBLE),
      fixtureOf(2, VISIBLE, IN_PERIOD),
      fixtureOf(3, VISIBLE, paidColumnsOf(3)),
      fixtureOf(4, VISIBLE, paidColumnsOf(4, IN_PERIOD)),
      fixtureOf(5, HIDDEN, paidColumnsOf(5, IN_PERIOD)),
      fixtureOf(6, VISIBLE, paidColumnsOf(6, PAST_PERIOD)),
      fixtureOf(7, DELETED, paidColumnsOf(7)),
      fixtureOf(8, OTHERS_PRODUCT, paidColumnsOf(8)),
    ]);
    const sessionToken = await issueSponsorshipSession(OWNER);

    const response = await fetchMySponsorships({ first: 20 }, { sessionToken });

    expect(response.errors).toBeUndefined();
    expect(response.data?.mySponsorships).toEqual({
      nodes: [
        nodeOf(7, { product: null, status: 'ENDED', amountPaid: USD(7000) }),
        nodeOf(6, {
          ...PAST_PERIOD,
          status: 'ENDED',
          amountPaid: USD(7000),
        }),
        nodeOf(5, {
          ...IN_PERIOD,
          product: {
            handle: 'product2',
            name: 'プロダクト2',
            logo: null,
            listed: false,
          },
          status: 'PAUSED',
          amountPaid: USD(7000),
        }),
        nodeOf(4, {
          ...IN_PERIOD,
          status: 'ACTIVE',
          amountPaid: USD(7000),
        }),
        nodeOf(3, { status: 'SCHEDULED', amountPaid: USD(7000) }),
        nodeOf(2, { ...IN_PERIOD, canResume: false }),
        nodeOf(1, { canResume: true }),
      ],
      pageInfo: { hasNextPage: false, endCursor: expect.any(String) as string },
      nextDayStartsAt: NEXT_DAY_STARTS_AT,
    });
  });

  test('強制終了日と理由と、依頼済み・返金済み・拒否の返金の日数と金額と状態を返し、返金が無い・返金不要はnullにする', async () => {
    await seedProducts();
    await insertSponsorships([
      fixtureOf(
        1,
        VISIBLE,
        terminatedColumnsOf(1, {
          ...IN_PERIOD,
          terminatedAt: TERMINATED_AT,
          terminationRefundStatus: 'requested',
          terminationRefundDays: 7,
          terminationRefundAmount: 4455,
          stopRefundStatus: 'already_refunded',
          stopRefundDays: 2,
          stopRefundAmount: null,
        }),
      ),
      fixtureOf(
        2,
        VISIBLE,
        terminatedColumnsOf(2, {
          ...IN_PERIOD,
          terminatedAt: TERMINATED_AT,
          terminationRefundStatus: 'not_needed',
          terminationRefundDays: 0,
          terminationRefundAmount: 0,
          stopRefundStatus: 'rejected',
          stopRefundDays: 1,
          stopRefundAmount: 636,
        }),
      ),
      fixtureOf(
        3,
        VISIBLE,
        paidColumnsOf(3, {
          ...PAST_PERIOD,
          stopRefundStatus: 'requested',
          stopRefundDays: 3,
          stopRefundAmount: 2100,
        }),
      ),
      fixtureOf(4, VISIBLE, paidColumnsOf(4, PAST_PERIOD)),
    ]);
    const sessionToken = await issueSponsorshipSession(OWNER);

    const response = await fetchMySponsorships({ first: 20 }, { sessionToken });

    expect(response.errors).toBeUndefined();
    expect(
      response.data?.mySponsorships?.nodes.map(
        ({
          id,
          status,
          terminatedOn,
          terminationReason,
          terminationRefund,
          displayStopRefund,
        }) => ({
          id,
          status,
          terminatedOn,
          terminationReason,
          terminationRefund,
          displayStopRefund,
        }),
      ),
    ).toEqual([
      {
        id: sponsorshipIdOf(4),
        status: 'ENDED',
        terminatedOn: null,
        terminationReason: null,
        terminationRefund: null,
        displayStopRefund: null,
      },
      {
        id: sponsorshipIdOf(3),
        status: 'ENDED',
        terminatedOn: null,
        terminationReason: null,
        terminationRefund: null,
        displayStopRefund: {
          days: 3,
          amount: USD(2100),
          status: 'REQUESTED',
        },
      },
      {
        id: sponsorshipIdOf(2),
        status: 'TERMINATED',
        terminatedOn: '2026-11-24',
        terminationReason: '規約に反する広告のため',
        terminationRefund: null,
        displayStopRefund: { days: 1, amount: USD(636), status: 'REJECTED' },
      },
      {
        id: sponsorshipIdOf(1),
        status: 'TERMINATED',
        terminatedOn: '2026-11-24',
        terminationReason: '規約に反する広告のため',
        terminationRefund: {
          days: 7,
          amount: USD(4455),
          status: 'REQUESTED',
        },
        displayStopRefund: {
          days: 2,
          amount: null,
          status: 'ALREADY_REFUNDED',
        },
      },
    ]);
  });

  test('firstの件数ずつ返し、前のページの位置から続きを返す', async () => {
    await seedProducts();
    await insertSponsorships([
      fixtureOf(1, VISIBLE),
      fixtureOf(2, VISIBLE),
      fixtureOf(3, VISIBLE),
    ]);
    const sessionToken = await issueSponsorshipSession(OWNER);

    const first = await fetchMySponsorships({ first: 2 }, { sessionToken });
    const second = await fetchMySponsorships(
      {
        first: 2,
        after: first.data?.mySponsorships?.pageInfo.endCursor ?? null,
      },
      { sessionToken },
    );

    expect(first.data?.mySponsorships?.nodes.map(({ id }) => id)).toEqual([
      sponsorshipIdOf(3),
      sponsorshipIdOf(2),
    ]);
    expect(first.data?.mySponsorships?.pageInfo.hasNextPage).toBe(true);
    expect(second.data?.mySponsorships?.nodes.map(({ id }) => id)).toEqual([
      sponsorshipIdOf(1),
    ]);
    expect(second.data?.mySponsorships?.pageInfo.hasNextPage).toBe(false);
  });

  test('申込が無ければ空の一覧と空の位置を返す', async () => {
    await seedProducts();
    const sessionToken = await issueSponsorshipSession(OWNER);

    const response = await fetchMySponsorships({ first: 20 }, { sessionToken });

    expect(response.data?.mySponsorships).toEqual({
      nodes: [],
      pageInfo: { hasNextPage: false, endCursor: null },
      nextDayStartsAt: NEXT_DAY_STARTS_AT,
    });
  });

  test.each([0, 21])(
    'firstが1〜20の外(%i)ならvalidation_errorで拒否する',
    async (first) => {
      await seedProducts();
      const sessionToken = await issueSponsorshipSession(OWNER);

      const response = await fetchMySponsorships({ first }, { sessionToken });

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(detailsOf(response)).toEqual([
        {
          field: 'first',
          code: expect.any(String) as string,
          message: PAGE_SIZE_MESSAGE,
        },
      ]);
    },
  );

  test('不正な位置はinvalid_cursorで拒否する', async () => {
    await seedProducts();
    const sessionToken = await issueSponsorshipSession(OWNER);

    const response = await fetchMySponsorships(
      { first: 20, after: 'not-a-cursor' },
      { sessionToken },
    );

    expect(codesOf(response)).toEqual(['invalid_cursor']);
  });

  test('ログインしていなければunauthenticatedで拒否する', async () => {
    await seedProducts();

    const response = await fetchMySponsorships({ first: 20 });

    expect(codesOf(response)).toEqual(['unauthenticated']);
  });

  test('管理者側の呼び出し元からはforbiddenで拒否する', async () => {
    await seedProducts();
    const sessionToken = await issueSponsorshipSession(OWNER);

    const response = await fetchMySponsorships(
      { first: 20 },
      { sessionToken, caller: 'admin' },
    );

    expect(codesOf(response)).toEqual(['forbidden']);
  });
});
