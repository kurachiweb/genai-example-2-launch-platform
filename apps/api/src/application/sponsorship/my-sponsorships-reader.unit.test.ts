import { describe, expect, test } from 'bun:test';

import type { SponsorshipRecord } from '../../../lib/core/sponsorship/ports.ts';
import { parseBusinessDate } from '../../../lib/core/time/business-time.ts';
import { DefaultMySponsorshipsReader } from './my-sponsorships-reader.ts';
import {
  NOW,
  OTHER_USER_ID,
  PRODUCT_ID,
  rejectionOf,
  SESSION,
  sponsorshipRecordOf,
  TODAY,
  USER_ID,
} from './testing/sponsorship-application-fakes.ts';
import {
  createReaderFakes,
  productSummaryOf,
  type ReaderFakeOptions,
  unauthenticatedError,
} from './testing/sponsorship-reader-fakes.ts';

const NEXT_DAY_STARTS_AT = new Date('2026-11-26T08:00:00.000Z');

const OTHER_PRODUCT_ID = '01JF0SPPRDT000000000000002';
const DELETED_PRODUCT_ID = '01JF0SPPRDT000000000000003';

function setup(options: ReaderFakeOptions = {}) {
  const fakes = createReaderFakes(options);
  const reader = new DefaultMySponsorshipsReader(
    fakes.guard,
    fakes.store,
    fakes.products,
  );
  return { ...fakes, reader };
}

const paidOf = (overrides: Partial<SponsorshipRecord>): SponsorshipRecord =>
  sponsorshipRecordOf({
    state: 'paid',
    purchaseId: '01JF0SPPRCH000000000000001',
    amountTotal: 14000,
    paidAt: NOW,
    ...overrides,
  });

const pageOf = (records: readonly SponsorshipRecord[]) => ({
  records,
  hasNextPage: false,
  endCursor: null,
});

describe('自分の広告一覧の照会', () => {
  test('ログインしていなければ、申込を読まずに拒否する', async () => {
    const guardError = unauthenticatedError();
    const { reader, calls } = setup({ guardError });

    expect(
      await rejectionOf(reader.list({ session: SESSION, first: 20, now: NOW })),
    ).toBe(guardError);
    expect(calls).toEqual([{ kind: 'requireUser' }]);
  });

  test('本人の申込を件数と続きの位置で読み、続きの有無と位置と次の0:00の時点を返す', async () => {
    const { reader, calls } = setup({
      page: {
        records: [sponsorshipRecordOf()],
        hasNextPage: true,
        endCursor: 'cursor-2',
      },
      summaries: [productSummaryOf()],
    });

    const result = await reader.list({
      session: SESSION,
      first: 20,
      after: 'cursor-1',
      now: NOW,
    });

    expect(calls).toContainEqual({
      kind: 'listByOwner',
      userId: USER_ID,
      page: { first: 20, after: 'cursor-1' },
    });
    expect(result.hasNextPage).toBe(true);
    expect(result.endCursor).toBe('cursor-2');
    expect(result.nextDayStartsAt).toEqual(NEXT_DAY_STARTS_AT);
  });

  test('続きの位置を渡さなければ、件数だけで読む', async () => {
    const { reader, calls } = setup();

    await reader.list({ session: SESSION, first: 20, now: NOW });

    expect(calls).toContainEqual({
      kind: 'listByOwner',
      userId: USER_ID,
      page: { first: 20 },
    });
  });

  test('ページのプロダクトを、重複を除いたIDで論理削除済みを除く照会1回で読む', async () => {
    const { reader, calls } = setup({
      page: pageOf([
        sponsorshipRecordOf({ id: '01JF0SPSPNS000000000000001' }),
        sponsorshipRecordOf({ id: '01JF0SPSPNS000000000000002' }),
        sponsorshipRecordOf({
          id: '01JF0SPSPNS000000000000003',
          productId: OTHER_PRODUCT_ID,
        }),
      ]),
      summaries: [
        productSummaryOf(),
        productSummaryOf({ productId: OTHER_PRODUCT_ID }),
      ],
    });

    await reader.list({ session: SESSION, first: 20, now: NOW });

    expect(calls.filter(({ kind }) => kind === 'findSummaries')).toEqual([
      {
        kind: 'findSummaries',
        productIds: [PRODUCT_ID, OTHER_PRODUCT_ID],
        scope: 'not-deleted',
      },
    ]);
  });

  test('申込が0件ならプロダクトを照会せず空の一覧を返す', async () => {
    const { reader, calls } = setup();

    const result = await reader.list({ session: SESSION, first: 20, now: NOW });

    expect(result).toEqual({
      views: [],
      hasNextPage: false,
      endCursor: null,
      nextDayStartsAt: NEXT_DAY_STARTS_AT,
    });
    expect(calls.some(({ kind }) => kind === 'findSummaries')).toBe(false);
  });

  test.each([
    ['未決済', sponsorshipRecordOf(), 'visible', 'pending_payment'],
    ['開始日より前の決済済み', paidOf({}), 'visible', 'scheduled'],
    [
      '期間内の決済済み',
      paidOf({ startsOn: TODAY, endsOn: parseBusinessDate('2026-12-07') }),
      'visible',
      'active',
    ],
    ['開始日より前で表示停止中', paidOf({}), 'hidden', 'paused'],
    [
      '期間内で表示停止中',
      paidOf({ startsOn: TODAY, endsOn: parseBusinessDate('2026-12-07') }),
      'hidden',
      'paused',
    ],
    [
      '終了日が過ぎた決済済み',
      paidOf({
        startsOn: parseBusinessDate('2026-11-01'),
        endsOn: parseBusinessDate('2026-11-24'),
      }),
      'visible',
      'ended',
    ],
    [
      '強制終了',
      sponsorshipRecordOf({
        state: 'terminated',
        terminatedAt: NOW,
        terminationReason: '規約に反する表示のため',
      }),
      'visible',
      'terminated',
    ],
  ] as const)(
    '%sの申込の状態を導き、プロダクトの要約を添える',
    async (_label, record, availability, status) => {
      const summary = productSummaryOf({
        visible: availability === 'visible',
        hidden: availability === 'hidden',
      });
      const { reader } = setup({
        page: pageOf([record]),
        summaries: [summary],
      });

      const { views } = await reader.list({
        session: SESSION,
        first: 20,
        now: NOW,
      });

      expect(views).toEqual([{ record, product: summary, status }]);
    },
  );

  test('プロダクトの論理削除が記録された決済済みは終了にし、プロダクトの要約を添えない', async () => {
    const record = paidOf({ productDeletedAt: NOW });
    const { reader } = setup({
      page: pageOf([record]),
      summaries: [productSummaryOf()],
    });

    const { views } = await reader.list({
      session: SESSION,
      first: 20,
      now: NOW,
    });

    expect(views).toEqual([{ record, product: undefined, status: 'ended' }]);
  });

  test('照会で返らない論理削除済みのプロダクトの決済済みは終了にし、未決済は未決済のままにする', async () => {
    const paid = paidOf({
      id: '01JF0SPSPNS000000000000001',
      productId: DELETED_PRODUCT_ID,
    });
    const unpaid = sponsorshipRecordOf({
      id: '01JF0SPSPNS000000000000002',
      productId: DELETED_PRODUCT_ID,
    });
    const { reader } = setup({ page: pageOf([paid, unpaid]), summaries: [] });

    const { views } = await reader.list({
      session: SESSION,
      first: 20,
      now: NOW,
    });

    expect(views).toEqual([
      { record: paid, product: undefined, status: 'ended' },
      { record: unpaid, product: undefined, status: 'pending_payment' },
    ]);
  });
});

describe('プロダクトの削除の確認の件数の照会', () => {
  const count = (
    reader: DefaultMySponsorshipsReader,
    productHandle = 'sponsored-product',
  ): Promise<number> =>
    reader.countActiveForProduct({ session: SESSION, productHandle, now: NOW });

  test('ログインしていなければ、プロダクトを解決せずに拒否する', async () => {
    const guardError = unauthenticatedError();
    const { reader, calls } = setup({ guardError });

    expect(await rejectionOf(count(reader))).toBe(guardError);
    expect(calls).toEqual([{ kind: 'requireUser' }]);
  });

  test.each(['current', 'previous'] as const)(
    '本人のプロダクトのハンドル(%s)なら、今日の掲載中・掲載予定の件数を返す',
    async (kind) => {
      const { reader, calls } = setup({
        resolution: { kind, product: productSummaryOf() },
        activeCount: 2,
      });

      expect(await count(reader)).toBe(2);
      expect(calls).toContainEqual({
        kind: 'countActiveForProduct',
        productId: PRODUCT_ID,
        today: TODAY,
      });
    },
  );

  test('本人以外のプロダクトは件数を数えず0を返す', async () => {
    const { reader, calls } = setup({
      resolution: {
        kind: 'current',
        product: productSummaryOf({ ownerUserId: OTHER_USER_ID }),
      },
      activeCount: 2,
    });

    expect(await count(reader)).toBe(0);
    expect(calls.some(({ kind }) => kind === 'countActiveForProduct')).toBe(
      false,
    );
  });

  test('解決できないハンドルは0を返す', async () => {
    const { reader } = setup({ resolution: { kind: 'none' }, activeCount: 2 });

    expect(await count(reader)).toBe(0);
  });

  test('ハンドルの形式に合わない値は、プロダクトを解決せずに0を返す', async () => {
    const { reader, calls } = setup({ activeCount: 2 });

    expect(await count(reader, 'not a handle')).toBe(0);
    expect(calls).toEqual([{ kind: 'requireUser' }]);
  });
});
