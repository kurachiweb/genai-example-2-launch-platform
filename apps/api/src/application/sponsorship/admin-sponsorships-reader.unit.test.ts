import { describe, expect, test } from 'bun:test';

import type { SponsorshipRecord } from '../../../lib/core/sponsorship/ports.ts';
import { parseBusinessDate } from '../../../lib/core/time/business-time.ts';
import { DefaultAdminSponsorshipsReader } from './admin-sponsorships-reader.ts';
import {
  NOW,
  OTHER_USER_ID,
  PRODUCT_ID,
  rejectionOf,
  sponsorshipRecordOf,
  TODAY,
  USER_ID,
} from './testing/sponsorship-application-fakes.ts';
import {
  createReaderFakes,
  forbiddenError,
  productSummaryOf,
  type ReaderFakeOptions,
  userSummaryOf,
} from './testing/sponsorship-reader-fakes.ts';

const OTHER_PRODUCT_ID = '01JF0SPPRDT000000000000002';
const DELETED_PRODUCT_ID = '01JF0SPPRDT000000000000003';
const WITHDRAWN_USER_ID = '01JF0SPUSER000000000000003';

function setup(options: ReaderFakeOptions = {}) {
  const fakes = createReaderFakes(options);
  const reader = new DefaultAdminSponsorshipsReader(
    fakes.store,
    fakes.products,
    fakes.profiles,
  );
  const list = (
    input: { readonly after?: string; readonly first?: number } & Partial<
      Pick<Parameters<DefaultAdminSponsorshipsReader['list']>[0], 'filter'>
    > = {},
  ) =>
    reader.list({
      requireRole: fakes.requireRole,
      filter: input.filter ?? {},
      first: input.first ?? 50,
      ...(input.after === undefined ? {} : { after: input.after }),
      now: NOW,
    });
  return { ...fakes, reader, list };
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

describe('管理画面のスポンサー広告の一覧の照会', () => {
  test('閲覧のみ以上のロールを最初に求める', async () => {
    const { list, calls } = setup({
      page: pageOf([sponsorshipRecordOf()]),
      summaries: [productSummaryOf()],
      userSummaries: [userSummaryOf()],
    });

    await list();

    expect(calls[0]).toEqual({ kind: 'requireRole', minimum: 'viewer' });
    expect(calls.filter(({ kind }) => kind === 'requireRole')).toHaveLength(1);
  });

  test('ロールの要求が拒否されたら、申込を読まずに拒否をそのまま返す', async () => {
    const roleError = forbiddenError();
    const { list, calls } = setup({ roleError });

    expect(await rejectionOf(list())).toBe(roleError);
    expect(calls).toEqual([{ kind: 'requireRole', minimum: 'viewer' }]);
  });

  test('絞り込みと今日と件数と続きの位置で申込を読み、続きの有無と位置を返す', async () => {
    const { list, calls } = setup({
      page: {
        records: [sponsorshipRecordOf()],
        hasNextPage: true,
        endCursor: 'cursor-2',
      },
      summaries: [productSummaryOf()],
      userSummaries: [userSummaryOf()],
    });

    const result = await list({
      filter: { status: 'active', tier: 'legend' },
      after: 'cursor-1',
    });

    expect(calls).toContainEqual({
      kind: 'listForAdmin',
      filter: { status: 'active', tier: 'legend' },
      today: TODAY,
      page: { first: 50, after: 'cursor-1' },
    });
    expect(result.hasNextPage).toBe(true);
    expect(result.endCursor).toBe('cursor-2');
  });

  test('絞り込みと続きの位置が無ければ、空の絞り込みと件数だけで読む', async () => {
    const { list, calls } = setup();

    await list();

    expect(calls).toContainEqual({
      kind: 'listForAdmin',
      filter: {},
      today: TODAY,
      page: { first: 50 },
    });
  });

  test('ページのプロダクトと申込者を、重複を除いたIDでそれぞれ1回の照会で読み、申込者は停止中を含む範囲で読む', async () => {
    const { list, calls } = setup({
      page: pageOf([
        sponsorshipRecordOf({ id: '01JF0SPSPNS000000000000001' }),
        sponsorshipRecordOf({ id: '01JF0SPSPNS000000000000002' }),
        sponsorshipRecordOf({
          id: '01JF0SPSPNS000000000000003',
          productId: OTHER_PRODUCT_ID,
          userId: OTHER_USER_ID,
        }),
      ]),
      summaries: [
        productSummaryOf(),
        productSummaryOf({ productId: OTHER_PRODUCT_ID }),
      ],
      userSummaries: [userSummaryOf()],
    });

    await list();

    expect(calls.filter(({ kind }) => kind === 'findSummaries')).toEqual([
      {
        kind: 'findSummaries',
        productIds: [PRODUCT_ID, OTHER_PRODUCT_ID],
        scope: 'not-deleted',
      },
    ]);
    expect(calls.filter(({ kind }) => kind === 'findUserSummaries')).toEqual([
      {
        kind: 'findUserSummaries',
        userIds: [USER_ID, OTHER_USER_ID],
        scope: 'not-withdrawn',
      },
    ]);
  });

  test('申込が0件ならプロダクトと申込者を照会せず空の一覧を返す', async () => {
    const { list, calls } = setup();

    expect(await list()).toEqual({
      views: [],
      hasNextPage: false,
      endCursor: null,
    });
    expect(
      calls.some(
        ({ kind }) => kind === 'findSummaries' || kind === 'findUserSummaries',
      ),
    ).toBe(false);
  });

  test('申込者のニックネームを添え、停止中の申込者も示し、照会で返らない申込者はnullにする', async () => {
    const { list } = setup({
      page: pageOf([
        sponsorshipRecordOf({ id: '01JF0SPSPNS000000000000001' }),
        sponsorshipRecordOf({
          id: '01JF0SPSPNS000000000000002',
          userId: OTHER_USER_ID,
        }),
        sponsorshipRecordOf({
          id: '01JF0SPSPNS000000000000003',
          userId: WITHDRAWN_USER_ID,
        }),
      ]),
      summaries: [productSummaryOf()],
      userSummaries: [
        userSummaryOf(),
        userSummaryOf({
          userId: OTHER_USER_ID,
          handle: 'suspended-sponsor',
          nickname: '停止中の広告主',
          suspended: true,
        }),
      ],
    });

    const { views } = await list();

    expect(views.map(({ applicantNickname }) => applicantNickname)).toEqual([
      '広告主',
      '停止中の広告主',
      null,
    ]);
  });

  test('表示停止中のプロダクトの決済済みは表示停止中の状態にし、強制終了できるものとする', async () => {
    const record = paidOf({});
    const summary = productSummaryOf({ visible: false, hidden: true });
    const { list } = setup({
      page: pageOf([record]),
      summaries: [summary],
      userSummaries: [userSummaryOf()],
    });

    const { views } = await list();

    expect(views).toEqual([
      {
        record,
        product: summary,
        status: 'paused',
        applicantNickname: '広告主',
        terminable: true,
      },
    ]);
  });

  test('プロダクトの論理削除が記録された決済済みは、プロダクトの要約を添えず終了にし、強制終了できないものとする', async () => {
    const record = paidOf({ productDeletedAt: NOW });
    const { list } = setup({
      page: pageOf([record]),
      summaries: [productSummaryOf()],
      userSummaries: [userSummaryOf()],
    });

    const { views } = await list();

    expect(views).toEqual([
      {
        record,
        product: undefined,
        status: 'ended',
        applicantNickname: '広告主',
        terminable: false,
      },
    ]);
  });

  test('照会で返らない論理削除済みのプロダクトは、プロダクトの要約を添えず終了にする', async () => {
    const record = paidOf({ productId: DELETED_PRODUCT_ID });
    const { list } = setup({
      page: pageOf([record]),
      summaries: [],
      userSummaries: [userSummaryOf()],
    });

    const { views } = await list();

    expect(views.map(({ product, status }) => ({ product, status }))).toEqual([
      { product: undefined, status: 'ended' },
    ]);
  });

  test.each([
    ['未決済', sponsorshipRecordOf(), 'pending_payment', false],
    ['開始日より前の決済済み', paidOf({}), 'scheduled', true],
    [
      '今日が終了日の決済済み',
      paidOf({ startsOn: parseBusinessDate('2026-11-19'), endsOn: TODAY }),
      'active',
      true,
    ],
    [
      '終了日が過ぎた決済済み',
      paidOf({
        startsOn: parseBusinessDate('2026-11-01'),
        endsOn: parseBusinessDate('2026-11-24'),
      }),
      'ended',
      false,
    ],
    [
      '強制終了',
      sponsorshipRecordOf({
        state: 'terminated',
        terminatedAt: NOW,
        terminationReason: '規約に反する表示のため',
      }),
      'terminated',
      false,
    ],
  ] as const)(
    '%sの申込の状態と強制終了できるかを導く',
    async (_label, record, status, terminable) => {
      const { list } = setup({
        page: pageOf([record]),
        summaries: [productSummaryOf()],
        userSummaries: [userSummaryOf()],
      });

      const { views } = await list();

      expect(
        views.map((view) => ({
          status: view.status,
          terminable: view.terminable,
        })),
      ).toEqual([{ status, terminable }]);
    },
  );
});
