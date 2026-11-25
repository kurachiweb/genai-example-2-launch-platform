import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';

import { products } from '../../../../../db/schema/product/products.ts';
import { productIdOf } from '../../../../../lib/workers/engagement/testing/engagement-fixtures.ts';
import {
  changeReportCaseStatus,
  closeReportCase,
  codesOf,
  COMMENT_CASE,
  DETACHED_CASE,
  detailsOf,
  failEmailSending,
  hoursAfterT0,
  INQUIRY_MESSAGE,
  INQUIRY_RESPONSE_MS,
  installReportCaseGraphQLTest,
  LAST_INQUIRY_MESSAGE,
  MISSING_CASE_ID,
  OWNER_EMAIL,
  PRODUCT,
  PRODUCT_CASE,
  PRODUCT_TARGET,
  readProductHiddenAt,
  readSentEmailRecipients,
  REASON,
  REJECT,
  REPORT_CASE_TEST_NOW,
  RESOLVE_WITH_MEASURE,
  RESOLVE_WITHOUT_MEASURE,
  sendInfringementInquiry,
  USER_CASE,
} from '../../../../../test/support/reporting-case-graphql-operations.ts';
import {
  caseIdOf,
  db,
  guestReportOf,
  openCaseOf,
  readAudits,
  readCase,
  rejectedColumns,
  seed,
  T0,
} from '../../../../infrastructure/reporting/testing/report-case-write-fixtures.ts';

installReportCaseGraphQLTest();

const CLOSED_PRODUCT_CASE = 5;

const REASON_501 = 'あ'.repeat(501);

describe('changeReportCaseStatus', () => {
  test('未対応から対応中へ変え、変更後の状態を返して監査ログを残す', async () => {
    const response = await changeReportCaseStatus({
      id: caseIdOf(COMMENT_CASE),
      from: 'OPEN',
      to: 'IN_PROGRESS',
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.changeReportCaseStatus).toEqual({
      status: 'IN_PROGRESS',
    });
    expect((await readCase(COMMENT_CASE))?.status).toBe('in_progress');
    expect((await readAudits()).map(({ action }) => action)).toEqual([
      'report.status-change',
    ]);
  });

  test('完了した案件を理由付きで対応中へ戻し、通知を送らない', async () => {
    const response = await changeReportCaseStatus({
      id: caseIdOf(USER_CASE),
      from: 'REJECTED',
      to: 'IN_PROGRESS',
      reason: REASON,
    });

    expect(response.data?.changeReportCaseStatus).toEqual({
      status: 'IN_PROGRESS',
    });
    expect(await readCase(USER_CASE)).toMatchObject({
      status: 'in_progress',
      closedAt: null,
    });
    expect(readSentEmailRecipients()).toEqual([]);
  });

  test('同じ対象に未完了の別の案件があれば、再開をreport_case_open_existsにする', async () => {
    await seed(
      [
        openCaseOf(CLOSED_PRODUCT_CASE, {
          ...PRODUCT_TARGET,
          lastReportedAt: T0,
          ...rejectedColumns(),
        }),
      ],
      [guestReportOf(6, CLOSED_PRODUCT_CASE)],
    );

    const response = await changeReportCaseStatus({
      id: caseIdOf(CLOSED_PRODUCT_CASE),
      from: 'REJECTED',
      to: 'OPEN',
      reason: REASON,
    });

    expect(codesOf(response)).toEqual(['report_case_open_exists']);
    expect((await readCase(CLOSED_PRODUCT_CASE))?.status).toBe('rejected');
    expect(await readAudits()).toEqual([]);
  });

  test.each([
    {
      name: '変更前の状態の不一致',
      variables: {
        id: caseIdOf(COMMENT_CASE),
        from: 'IN_PROGRESS',
        to: 'OPEN',
      },
      code: 'report_case_state_conflict',
      fields: [],
    },
    {
      name: '同じ状態への変更',
      variables: { id: caseIdOf(COMMENT_CASE), from: 'OPEN', to: 'OPEN' },
      code: 'validation_error',
      fields: ['status'],
    },
    {
      name: '理由の無い再開',
      variables: { id: caseIdOf(USER_CASE), from: 'REJECTED', to: 'OPEN' },
      code: 'validation_error',
      fields: ['reason'],
    },
    {
      name: '501文字の理由',
      variables: {
        id: caseIdOf(COMMENT_CASE),
        from: 'OPEN',
        to: 'IN_PROGRESS',
        reason: REASON_501,
      },
      code: 'validation_error',
      fields: ['reason'],
    },
    {
      name: '無い案件',
      variables: { id: MISSING_CASE_ID, from: 'OPEN', to: 'IN_PROGRESS' },
      code: 'report_case_not_found',
      fields: [],
    },
  ])('$nameを$codeにする', async ({ variables, code, fields }) => {
    const response = await changeReportCaseStatus(variables);

    expect(codesOf(response)).toEqual([code]);
    expect(detailsOf(response).map((detail) => detail.field)).toEqual(fields);
    expect(await readAudits()).toEqual([]);
  });
});

describe('案件の完了の操作', () => {
  test('措置による対応済は対象を非公開化し、対応済を返す', async () => {
    const response = await closeReportCase(
      RESOLVE_WITH_MEASURE,
      caseIdOf(PRODUCT_CASE),
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.resolveReportCaseWithMeasure).toEqual({
      status: 'RESOLVED',
    });
    expect(await readProductHiddenAt()).toEqual(REPORT_CASE_TEST_NOW);
    expect(await readCase(PRODUCT_CASE)).toMatchObject({
      status: 'resolved',
      resolution: 'product.hide',
      closingReason: REASON,
    });
  });

  test('措置なしの対応済は措置をnoneにして対応済を返す', async () => {
    const response = await closeReportCase(
      RESOLVE_WITHOUT_MEASURE,
      caseIdOf(COMMENT_CASE),
    );

    expect(response.data?.resolveReportCaseWithoutMeasure).toEqual({
      status: 'RESOLVED',
    });
    expect(await readCase(COMMENT_CASE)).toMatchObject({
      status: 'resolved',
      resolution: 'none',
    });
  });

  test('却下は却下を返し、投稿者への通知を依頼する', async () => {
    const response = await closeReportCase(REJECT, caseIdOf(COMMENT_CASE));

    expect(response.data?.rejectReportCase).toEqual({ status: 'REJECTED' });
    expect(await readCase(COMMENT_CASE)).toMatchObject({
      status: 'rejected',
      resolution: null,
      posterNoticeStatus: 'requested',
    });
  });

  test('対象への参照を消した案件の措置をreport_target_unavailableにする', async () => {
    const response = await closeReportCase(
      RESOLVE_WITH_MEASURE,
      caseIdOf(DETACHED_CASE),
    );

    expect(codesOf(response)).toEqual(['report_target_unavailable']);
    expect((await readCase(DETACHED_CASE))?.status).toBe('open');
  });

  test('既に非公開化した対象の措置をreport_measure_already_appliedにする', async () => {
    await db
      .update(products)
      .set({ hiddenAt: T0 })
      .where(eq(products.id, productIdOf(PRODUCT)));

    const response = await closeReportCase(
      RESOLVE_WITH_MEASURE,
      caseIdOf(PRODUCT_CASE),
    );

    expect(codesOf(response)).toEqual(['report_measure_already_applied']);
    expect((await readCase(PRODUCT_CASE))?.status).toBe('in_progress');
  });

  test.each([
    { name: '措置による対応済', document: RESOLVE_WITH_MEASURE },
    { name: '措置なしの対応済', document: RESOLVE_WITHOUT_MEASURE },
    { name: '却下', document: REJECT },
  ])(
    '$nameは完了した案件をreport_case_closedに、空白だけと501文字の理由をvalidation_errorに、無い案件をreport_case_not_foundにする',
    async ({ document }) => {
      expect(
        codesOf(await closeReportCase(document, caseIdOf(USER_CASE))),
      ).toEqual(['report_case_closed']);
      for (const reason of [' \n', REASON_501]) {
        const response = await closeReportCase(
          document,
          caseIdOf(COMMENT_CASE),
          reason,
        );

        expect(codesOf(response)).toEqual(['validation_error']);
        expect(detailsOf(response).map((detail) => detail.field)).toEqual([
          'reason',
        ]);
      }
      expect(codesOf(await closeReportCase(document, MISSING_CASE_ID))).toEqual(
        ['report_case_not_found'],
      );
      expect(await readAudits()).toEqual([]);
    },
  );
});

describe('sendInfringementInquiry', () => {
  test('対応中の権利侵害の案件の投稿者へ照会を送り、送った日時と回答の期限を返す', async () => {
    const response = await sendInfringementInquiry({
      id: caseIdOf(PRODUCT_CASE),
      message: INQUIRY_MESSAGE,
      reason: REASON,
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.sendInfringementInquiry).toEqual({
      sentAt: REPORT_CASE_TEST_NOW.toISOString(),
      deadline: new Date(
        REPORT_CASE_TEST_NOW.getTime() + INQUIRY_RESPONSE_MS,
      ).toISOString(),
    });
    expect(readSentEmailRecipients()).toEqual([OWNER_EMAIL]);
    expect(await readCase(PRODUCT_CASE)).toMatchObject({
      lastInquiredAt: REPORT_CASE_TEST_NOW,
      lastInquiryMessage: INQUIRY_MESSAGE,
    });
  });

  test.each([
    {
      name: '未対応の案件',
      variables: { id: caseIdOf(COMMENT_CASE), message: INQUIRY_MESSAGE },
      code: 'report_inquiry_not_applicable',
      fields: [],
    },
    {
      name: '完了した案件',
      variables: { id: caseIdOf(USER_CASE), message: INQUIRY_MESSAGE },
      code: 'report_case_closed',
      fields: [],
    },
    {
      name: '無い案件',
      variables: { id: MISSING_CASE_ID, message: INQUIRY_MESSAGE },
      code: 'report_case_not_found',
      fields: [],
    },
    {
      name: '空白だけの内容',
      variables: { id: caseIdOf(PRODUCT_CASE), message: ' \n' },
      code: 'validation_error',
      fields: ['message'],
    },
    {
      name: '1,001文字の内容',
      variables: { id: caseIdOf(PRODUCT_CASE), message: 'あ'.repeat(1001) },
      code: 'validation_error',
      fields: ['message'],
    },
    {
      name: '501文字の理由',
      variables: {
        id: caseIdOf(PRODUCT_CASE),
        message: INQUIRY_MESSAGE,
        reason: REASON_501,
      },
      code: 'validation_error',
      fields: ['reason'],
    },
  ])('$nameを$codeにし、送らない', async ({ variables, code, fields }) => {
    const response = await sendInfringementInquiry(variables);

    expect(codesOf(response)).toEqual([code]);
    expect(detailsOf(response).map((detail) => detail.field)).toEqual(fields);
    expect(readSentEmailRecipients()).toEqual([]);
    expect(await readAudits()).toEqual([]);
  });

  test('送信の依頼の失敗をreport_inquiry_send_failedにし、照会を記録しない', async () => {
    failEmailSending(new Error('送信の依頼に失敗しました'));

    const response = await sendInfringementInquiry({
      id: caseIdOf(PRODUCT_CASE),
      message: INQUIRY_MESSAGE,
    });

    expect(codesOf(response)).toEqual(['report_inquiry_send_failed']);
    expect(await readCase(PRODUCT_CASE)).toMatchObject({
      lastInquiredAt: hoursAfterT0(1),
      lastInquiryMessage: LAST_INQUIRY_MESSAGE,
    });
    expect(await readAudits()).toEqual([]);
  });
});
