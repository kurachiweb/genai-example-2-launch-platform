import { describe, expect, test } from 'vitest';

import {
  insertDisplayStops,
  insertSponsorProduct,
  insertSponsorships,
  insertSponsorshipPurchase,
  insertSponsorUser,
  paidColumnsOf,
  productIdOf,
  sponsorshipIdOf,
  sponsorshipPurchaseIdOf,
  T0,
  terminatedColumnsOf,
} from '../../../../../lib/workers/sponsorship/testing/sponsorship-fixtures.ts';
import { adminIdOf } from '../../../../infrastructure/admin/testing/admin-store-fixtures.ts';
import {
  asSponsorshipAdmin,
  codesOf,
  detailsOf,
  fetchTerminationPreview,
  installSponsorshipAdminGraphQLTest,
  readAuditLogs,
  readRefundRequests,
  readTerminationColumns,
  rejectSponsorshipRefunds,
  SPONSORSHIP_ADMINS,
  terminateSponsorship,
} from '../../../../../test/support/sponsorship-admin-graphql-operations.ts';
import { SPONSORSHIP_TEST_NOW } from '../../../../../test/support/sponsorship-graphql-operations.ts';

installSponsorshipAdminGraphQLTest();

const OWNER = 1;

const SPONSORSHIP = 1;

const SPONSORSHIP_ID = sponsorshipIdOf(SPONSORSHIP);

const PURCHASE_ID = sponsorshipPurchaseIdOf(SPONSORSHIP);

const REASON = '規約に反する広告のため';

const NOT_TERMINABLE_MESSAGE =
  'この広告は強制終了できません。一覧を再読み込みしてください。';

// 11-20〜11-29の10日間・10,000セント(1日1,000セント)。業務日付の今日11-25から5日が未掲載
const PERIOD = Object.freeze({
  startsOn: '2026-11-20',
  endsOn: '2026-11-29',
  days: 10,
  amountTotal: 10_000,
});

const USD = (amount: number) => ({ amount, currency: 'usd' });

const PREVIEW = Object.freeze({
  id: SPONSORSHIP_ID,
  days: 10,
  amountPaid: USD(10_000),
  unexposedDays: 5,
  refundEstimate: USD(5_000),
  stoppedDays: 2,
  stopRefundAmount: USD(2_000),
});

const NOT_TERMINATED = Object.freeze({
  state: 'paid',
  terminatedAt: null,
  terminationReason: null,
  terminationRefundStatus: 'none',
  stopRefundStatus: 'none',
});

const asModerator = () => asSponsorshipAdmin(SPONSORSHIP_ADMINS.moderator);

interface ArrangeOptions {
  readonly refundedAmount?: number;
  readonly displayStop?: boolean;
}

async function arrange({
  refundedAmount = 0,
  displayStop = true,
}: ArrangeOptions = {}): Promise<void> {
  await insertSponsorUser(OWNER);
  await insertSponsorProduct({ index: 1, owner: OWNER });
  await insertSponsorships([
    {
      index: SPONSORSHIP,
      owner: OWNER,
      product: 1,
      columns: paidColumnsOf(SPONSORSHIP, PERIOD),
    },
  ]);
  await insertSponsorshipPurchase({
    index: SPONSORSHIP,
    owner: OWNER,
    amountTotal: PERIOD.amountTotal,
    refundedAmount,
  });
  if (displayStop) {
    // 11-22 10:00から11-24 0:00ちょうどまで(11-22・11-23の2日)
    await insertDisplayStops([
      {
        index: 1,
        subject: { kind: 'product', productId: productIdOf(1) },
        startedAt: new Date('2026-11-22T18:00:00.000Z'),
        endedAt: new Date('2026-11-24T08:00:00.000Z'),
      },
    ]);
  }
}

const terminate = (reason: string = REASON, id: string = SPONSORSHIP_ID) =>
  terminateSponsorship({ id, reason }, asModerator());

describe('強制終了の照会と確定 呼び出し元とロール', () => {
  test.each([
    ['照会', () => fetchTerminationPreview(SPONSORSHIP_ID)],
    [
      '確定',
      () => terminateSponsorship({ id: SPONSORSHIP_ID, reason: REASON }),
    ],
  ])('利用者側の呼び出し元からの%sはforbiddenで拒否する', async (_, call) => {
    await arrange();

    const response = await call();

    expect(codesOf(response)).toEqual(['forbidden']);
    expect(await readTerminationColumns(SPONSORSHIP)).toEqual(NOT_TERMINATED);
  });

  test.each([
    [
      '照会',
      () => fetchTerminationPreview(SPONSORSHIP_ID, { caller: 'admin' }),
    ],
    [
      '確定',
      () =>
        terminateSponsorship(
          { id: SPONSORSHIP_ID, reason: REASON },
          { caller: 'admin' },
        ),
    ],
  ])(
    '管理者のセッションが無ければ%sをunauthenticatedで拒否する',
    async (_, call) => {
      await arrange();

      const response = await call();

      expect(codesOf(response)).toEqual(['unauthenticated']);
    },
  );

  test('閲覧のみの管理者の照会はforbiddenで拒否する', async () => {
    await arrange();

    const response = await fetchTerminationPreview(
      SPONSORSHIP_ID,
      asSponsorshipAdmin(SPONSORSHIP_ADMINS.viewer),
    );

    expect(codesOf(response)).toEqual(['forbidden']);
  });

  test('閲覧のみの管理者の強制終了はforbiddenで拒否し、申込・返金の依頼・監査ログを変えない', async () => {
    await arrange();

    const response = await terminateSponsorship(
      { id: SPONSORSHIP_ID, reason: REASON },
      asSponsorshipAdmin(SPONSORSHIP_ADMINS.viewer),
    );

    expect(codesOf(response)).toEqual(['forbidden']);
    expect(await readTerminationColumns(SPONSORSHIP)).toEqual(NOT_TERMINATED);
    expect(await readRefundRequests()).toEqual([]);
    expect(await readAuditLogs()).toEqual([]);
  });

  test('最上位管理者も強制終了できる', async () => {
    await arrange();

    const response = await terminateSponsorship(
      { id: SPONSORSHIP_ID, reason: REASON },
      asSponsorshipAdmin(SPONSORSHIP_ADMINS.superAdmin),
    );

    expect(response.errors).toBeUndefined();
    expect((await readAuditLogs())[0]?.operatorAdminId).toBe(
      adminIdOf(SPONSORSHIP_ADMINS.superAdmin),
    );
  });
});

describe('sponsorshipTerminationPreview', () => {
  test('モデレーターに未掲載日数・返金目安額・表示停止日数・表示停止の返金額を返し、何も書き込まない', async () => {
    await arrange();

    const response = await fetchTerminationPreview(
      SPONSORSHIP_ID,
      asModerator(),
    );

    expect(response.data?.sponsorshipTerminationPreview).toEqual(PREVIEW);
    expect(await readTerminationColumns(SPONSORSHIP)).toEqual(NOT_TERMINATED);
    expect(await readRefundRequests()).toEqual([]);
    expect(await readAuditLogs()).toEqual([]);
  });

  test('表示停止が無ければ表示停止日数と返金額を0にする', async () => {
    await arrange({ displayStop: false });

    const response = await fetchTerminationPreview(
      SPONSORSHIP_ID,
      asModerator(),
    );

    expect(response.data?.sponsorshipTerminationPreview).toEqual({
      ...PREVIEW,
      stoppedDays: 0,
      stopRefundAmount: USD(0),
    });
  });
});

describe('terminateSponsorship 確定の結果', () => {
  test('強制終了を確定し、日数・金額・依頼した返金の状態と額・強制終了日・購入の識別を返し、返金の依頼と監査ログを記録する', async () => {
    await arrange();

    const response = await terminate(`  ${REASON}  `);

    expect(response.data?.terminateSponsorship).toEqual({
      ...PREVIEW,
      terminatedOn: '2026-11-25',
      terminationRefundStatus: 'REQUESTED',
      stopRefundStatus: 'REQUESTED',
      terminationRefundRequested: USD(5_000),
      stopRefundRequested: USD(2_000),
      purchaseId: PURCHASE_ID,
    });
    expect(await readTerminationColumns(SPONSORSHIP)).toEqual({
      state: 'terminated',
      terminatedAt: SPONSORSHIP_TEST_NOW,
      terminationReason: REASON,
      terminationRefundStatus: 'requested',
      stopRefundStatus: 'requested',
    });
    expect(await readRefundRequests()).toEqual([
      {
        requestKey: `sponsorship:${PURCHASE_ID}:sponsorship_display_stopped`,
        amount: 2_000,
        reason: 'sponsorship_display_stopped',
      },
      {
        requestKey: `sponsorship:${PURCHASE_ID}:sponsorship_terminated`,
        amount: 5_000,
        reason: 'sponsorship_terminated',
      },
    ]);
    expect(await readAuditLogs()).toEqual([
      {
        operatorAdminId: adminIdOf(SPONSORSHIP_ADMINS.moderator),
        action: 'sponsorship.terminate',
        reason: REASON,
        detail: {
          unexposedDays: '5',
          refundEstimate: '5000',
          stoppedDays: '2',
          stopRefundAmount: '2000',
        },
      },
    ]);
  });

  test('表示停止の返金額が0なら表示停止の返金の状態と依頼した額を空にする', async () => {
    await arrange({ displayStop: false });

    const response = await terminate();

    expect(response.data?.terminateSponsorship).toMatchObject({
      stoppedDays: 0,
      stopRefundAmount: USD(0),
      terminationRefundStatus: 'REQUESTED',
      stopRefundStatus: null,
      terminationRefundRequested: USD(5_000),
      stopRefundRequested: null,
    });
    expect(
      (await readRefundRequests()).map(({ requestKey }) => requestKey),
    ).toEqual([`sponsorship:${PURCHASE_ID}:sponsorship_terminated`]);
  });

  test('管理者が全額を返金済みの購入は、返金済みの状態で依頼した額を空にする', async () => {
    await arrange({ refundedAmount: PERIOD.amountTotal });

    const response = await terminate();

    expect(response.data?.terminateSponsorship).toMatchObject({
      unexposedDays: 5,
      refundEstimate: USD(5_000),
      terminationRefundStatus: 'ALREADY_REFUNDED',
      stopRefundStatus: 'ALREADY_REFUNDED',
      terminationRefundRequested: null,
      stopRefundRequested: null,
      purchaseId: PURCHASE_ID,
    });
    expect(await readTerminationColumns(SPONSORSHIP)).toMatchObject({
      state: 'terminated',
      terminationRefundStatus: 'already_refunded',
      stopRefundStatus: 'already_refunded',
    });
  });

  test('決済の機能が返金の依頼を拒否すると、拒否の状態で依頼した額を空にし、強制終了は確定する', async () => {
    await arrange();
    rejectSponsorshipRefunds('invalid_amount');

    const response = await terminate();

    expect(response.data?.terminateSponsorship).toMatchObject({
      terminationRefundStatus: 'REJECTED',
      stopRefundStatus: 'REJECTED',
      terminationRefundRequested: null,
      stopRefundRequested: null,
      purchaseId: PURCHASE_ID,
    });
    expect(await readTerminationColumns(SPONSORSHIP)).toMatchObject({
      state: 'terminated',
      terminationRefundStatus: 'rejected',
      stopRefundStatus: 'rejected',
    });
    expect(await readRefundRequests()).toEqual([]);
    expect(await readAuditLogs()).toHaveLength(1);
  });
});

describe('terminateSponsorship 理由の検証', () => {
  test.each([
    ['空', '', 'reason_required', '理由を入力してください。'],
    ['空白だけ', ' \n\t ', 'reason_required', '理由を入力してください。'],
    [
      '501文字',
      'あ'.repeat(501),
      'reason_too_long',
      '理由は500文字以内で入力してください。',
    ],
  ])(
    '理由が%sならvalidation_errorで拒否し、申込・返金の依頼・監査ログを変えない',
    async (_, reason, code, message) => {
      await arrange();

      const response = await terminate(reason);

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(detailsOf(response)).toEqual([{ field: 'reason', code, message }]);
      expect(await readTerminationColumns(SPONSORSHIP)).toEqual(NOT_TERMINATED);
      expect(await readRefundRequests()).toEqual([]);
      expect(await readAuditLogs()).toEqual([]);
    },
  );
});

describe('強制終了できない申込', () => {
  test.each([
    ['未決済', { startsOn: '2026-11-20', endsOn: '2026-11-29', days: 10 }],
    [
      '終了済み',
      paidColumnsOf(SPONSORSHIP, {
        startsOn: '2026-11-15',
        endsOn: '2026-11-24',
        days: 10,
      }),
    ],
    ['強制終了済み', terminatedColumnsOf(SPONSORSHIP, PERIOD)],
    [
      'プロダクトの論理削除済み',
      paidColumnsOf(SPONSORSHIP, { ...PERIOD, productDeletedAt: T0 }),
    ],
  ])(
    '%sの申込の照会と確定はsponsorship_not_terminableで拒否し、何も書き込まない',
    async (_, columns) => {
      await insertSponsorUser(OWNER);
      await insertSponsorProduct({ index: 1, owner: OWNER });
      await insertSponsorships([
        { index: SPONSORSHIP, owner: OWNER, product: 1, columns },
      ]);

      const preview = await fetchTerminationPreview(
        SPONSORSHIP_ID,
        asModerator(),
      );
      const termination = await terminate();

      expect(codesOf(preview)).toEqual(['sponsorship_not_terminable']);
      expect(codesOf(termination)).toEqual(['sponsorship_not_terminable']);
      expect(termination.errors?.[0]?.message).toBe(NOT_TERMINABLE_MESSAGE);
      expect(await readRefundRequests()).toEqual([]);
      expect(await readAuditLogs()).toEqual([]);
    },
  );

  test('存在しない申込の照会と確定はsponsorship_not_terminableで拒否する', async () => {
    const preview = await fetchTerminationPreview(
      sponsorshipIdOf(99),
      asModerator(),
    );
    const termination = await terminate(REASON, sponsorshipIdOf(99));

    expect(codesOf(preview)).toEqual(['sponsorship_not_terminable']);
    expect(codesOf(termination)).toEqual(['sponsorship_not_terminable']);
  });

  test('形式の違う申込IDの照会と確定は、存在しない申込と同じ文言のvalidation_errorで拒否する', async () => {
    const preview = await fetchTerminationPreview('not-an-id', asModerator());
    const termination = await terminate(
      REASON,
      sponsorshipIdOf(1).toLowerCase(),
    );

    for (const response of [preview, termination]) {
      expect(codesOf(response)).toEqual(['validation_error']);
      expect(detailsOf(response)).toEqual([
        {
          field: 'id',
          code: 'invalid_format',
          message: NOT_TERMINABLE_MESSAGE,
        },
      ]);
    }
  });

  test('強制終了の後に同じ申込を強制終了するとsponsorship_not_terminableで拒否し、返金の依頼と監査ログは1回目のまま', async () => {
    await arrange();
    await terminate();

    const second = await terminate();

    expect(codesOf(second)).toEqual(['sponsorship_not_terminable']);
    expect(await readRefundRequests()).toHaveLength(2);
    expect(await readAuditLogs()).toHaveLength(1);
  });
});
