import { describe, expect, test } from 'vitest';

import {
  REPORT_CATEGORY_INFRINGEMENT_ID,
  REPORT_CATEGORY_INFRINGEMENT_NAME,
  REPORT_CATEGORY_OTHER_ID,
  REPORT_CATEGORY_OTHER_NAME,
} from '../../../../../common-lib/reporting/report-rules.ts';
import {
  commentIdOf,
  productIdOf,
  userIdOf,
} from '../../../../../lib/workers/engagement/testing/engagement-fixtures.ts';
import {
  asModerator,
  asSuperAdmin,
  asViewer,
  callReportCaseOperation,
  codesOf,
  COMMENT,
  COMMENT_CASE,
  DETACHED_CASE,
  detailsOf,
  fetchReportCase,
  fetchReportCases,
  hoursAfterT0,
  INQUIRY_RESPONSE_MS,
  installReportCaseGraphQLTest,
  LAST_INQUIRY_MESSAGE,
  MISSING_CASE_ID,
  OWNER,
  PRODUCT,
  PRODUCT_CASE,
  purgeCaseAfterNextFind,
  readProductHiddenAt,
  readSentEmailRecipients,
  REPORT_CASE_OPERATIONS,
  REPORT_CASE_QUERIES,
  REPORT_CASE_TEST_NOW,
  USER_CASE,
} from '../../../../../test/support/reporting-case-graphql-operations.ts';
import {
  caseIdOf,
  readAudits,
  readCase,
  reportIdOf,
  T0,
} from '../../../../infrastructure/reporting/testing/report-case-write-fixtures.ts';

installReportCaseGraphQLTest();

const ALL_OPERATIONS = [...REPORT_CASE_QUERIES, ...REPORT_CASE_OPERATIONS];

describe('案件の照会と操作の認可', () => {
  test.each(ALL_OPERATIONS)(
    '$nameは利用者側からの要求を、入力の検証より前にforbiddenで拒否する',
    async ({ document, invalid }) => {
      const response = await callReportCaseOperation(document, invalid, {
        ...asSuperAdmin(),
        caller: 'client',
      });

      expect(codesOf(response)).toEqual(['forbidden']);
    },
  );

  test.each(ALL_OPERATIONS)(
    '$nameは未ログインの管理者側の要求をunauthenticatedで拒否する',
    async ({ document, variables }) => {
      const response = await callReportCaseOperation(
        document,
        variables(caseIdOf(PRODUCT_CASE)),
        { caller: 'admin' },
      );

      expect(codesOf(response)).toEqual(['unauthenticated']);
    },
  );

  test.each(REPORT_CASE_QUERIES)(
    '$nameは閲覧のみの管理者に許す',
    async ({ document, variables }) => {
      const response = await callReportCaseOperation(
        document,
        variables(caseIdOf(PRODUCT_CASE)),
        asViewer(),
      );

      expect(response.errors).toBeUndefined();
    },
  );

  test.each(REPORT_CASE_OPERATIONS)(
    '$nameは閲覧のみの管理者をforbiddenで拒否し、案件を変えない',
    async ({ document, variables }) => {
      const before = await readCase(PRODUCT_CASE);

      const response = await callReportCaseOperation(
        document,
        variables(caseIdOf(PRODUCT_CASE)),
        asViewer(),
      );

      expect(codesOf(response)).toEqual(['forbidden']);
      expect(await readCase(PRODUCT_CASE)).toEqual(before);
      expect(await readAudits()).toEqual([]);
      expect(readSentEmailRecipients()).toEqual([]);
    },
  );

  test.each(REPORT_CASE_OPERATIONS)(
    '$nameは読んだ後に物理削除された案件の操作をreport_case_not_foundにし、何も残さない',
    async ({ document, variables }) => {
      const detail = await fetchReportCase(caseIdOf(PRODUCT_CASE));
      expect(detail.data?.adminReportCase).not.toBeNull();
      purgeCaseAfterNextFind(caseIdOf(PRODUCT_CASE));

      const response = await callReportCaseOperation(
        document,
        variables(caseIdOf(PRODUCT_CASE)),
        asModerator(),
      );

      expect(codesOf(response)).toEqual(['report_case_not_found']);
      expect(await readCase(PRODUCT_CASE)).toBeUndefined();
      expect(await readAudits()).toEqual([]);
      expect(await readProductHiddenAt()).toBeNull();
    },
  );
});

const PRODUCT_CASE_NODE = Object.freeze({
  id: caseIdOf(PRODUCT_CASE),
  target: {
    kind: 'PRODUCT',
    id: productIdOf(PRODUCT),
    detached: false,
    available: true,
    handle: 'product1',
    label: 'プロダクト1',
    excerpt: null,
    productId: productIdOf(PRODUCT),
    productName: null,
    productHandle: null,
  },
  status: 'IN_PROGRESS',
  reportCount: 2,
  categoryCounts: [
    {
      categoryId: REPORT_CATEGORY_INFRINGEMENT_ID,
      name: REPORT_CATEGORY_INFRINGEMENT_NAME,
      count: 1,
    },
    {
      categoryId: REPORT_CATEGORY_OTHER_ID,
      name: REPORT_CATEGORY_OTHER_NAME,
      count: 1,
    },
  ],
  firstReportedAt: T0.toISOString(),
  lastReportedAt: hoursAfterT0(3).toISOString(),
  infringement: true,
  responseTime: {
    startedAt: T0.toISOString(),
    completedAt: null,
    elapsedSeconds: (REPORT_CASE_TEST_NOW.getTime() - T0.getTime()) / 1000,
    alerts: [],
  },
});

describe('adminReportCases', () => {
  test('最後の受付日時の新しい順に、対象と内訳と対応期間を接続の形で返し、続きの位置で次のページを返す', async () => {
    const first = await fetchReportCases({ first: 2 });

    expect(first.errors).toBeUndefined();
    const page = first.data?.adminReportCases;
    expect(page?.nodes.map(({ id }) => id)).toEqual([
      caseIdOf(PRODUCT_CASE),
      caseIdOf(COMMENT_CASE),
    ]);
    expect(page?.nodes[0]).toEqual(PRODUCT_CASE_NODE);
    expect(page?.nodes[1]).toMatchObject({
      target: {
        kind: 'COMMENT',
        id: commentIdOf(COMMENT),
        detached: false,
        available: true,
        handle: null,
        label: null,
        excerpt: 'コメント1',
        productId: productIdOf(PRODUCT),
        productName: 'プロダクト1',
        productHandle: 'product1',
      },
      status: 'OPEN',
      infringement: false,
      responseTime: null,
    });
    expect(page?.pageInfo.hasNextPage).toBe(true);
    expect(page?.pageInfo.endCursor).toEqual(expect.any(String));

    const second = await fetchReportCases({
      first: 2,
      after: page?.pageInfo.endCursor,
    });

    expect(second.data?.adminReportCases?.nodes.map(({ id }) => id)).toEqual([
      caseIdOf(USER_CASE),
      caseIdOf(DETACHED_CASE),
    ]);
    expect(second.data?.adminReportCases?.pageInfo).toEqual({
      hasNextPage: false,
      endCursor: null,
    });
  });

  test('対象への参照を消した案件は、対象のIDをnullにしてdetachedを真、availableを偽で返す', async () => {
    const response = await fetchReportCases({ first: 10 });

    expect(response.data?.adminReportCases?.nodes.at(-1)).toMatchObject({
      id: caseIdOf(DETACHED_CASE),
      target: {
        kind: 'PRODUCT',
        id: null,
        detached: true,
        available: false,
        handle: null,
        label: null,
        productId: null,
      },
      status: 'OPEN',
    });
  });

  test.each([
    {
      name: '対応ステータス',
      filter: { status: 'REJECTED' },
      expected: [USER_CASE],
    },
    {
      name: '対象の種類',
      filter: { targetKind: 'COMMENT' },
      expected: [COMMENT_CASE],
    },
    {
      name: 'カテゴリ',
      filter: { categoryId: REPORT_CATEGORY_INFRINGEMENT_ID },
      expected: [PRODUCT_CASE],
    },
    {
      name: '受付の期間(開始を含み終了を含まない)',
      filter: {
        reportedFrom: hoursAfterT0(1).toISOString(),
        reportedBefore: hoursAfterT0(3).toISOString(),
      },
      expected: [COMMENT_CASE, USER_CASE],
    },
  ])('$nameで絞り込む', async ({ filter, expected }) => {
    const response = await fetchReportCases({ filter, first: 10 });

    expect(response.errors).toBeUndefined();
    expect(response.data?.adminReportCases?.nodes.map(({ id }) => id)).toEqual(
      expected.map(caseIdOf),
    );
  });

  test.each([
    { name: '件数の0', variables: { first: 0 }, field: 'first' },
    { name: '件数の51', variables: { first: 51 }, field: 'first' },
    {
      name: '逆の期間',
      variables: {
        first: 10,
        filter: {
          reportedFrom: hoursAfterT0(3).toISOString(),
          reportedBefore: hoursAfterT0(1).toISOString(),
        },
      },
      field: 'filter.reportedBefore',
    },
    {
      name: '形式の違うカテゴリのID',
      variables: { first: 10, filter: { categoryId: 'not-a-ulid' } },
      field: 'filter.categoryId',
    },
  ])('$nameをvalidation_errorで拒否する', async ({ variables, field }) => {
    const response = await fetchReportCases(variables);

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response).map((detail) => detail.field)).toEqual([field]);
  });

  test('不正な続きの位置をinvalid_cursorで拒否する', async () => {
    const response = await fetchReportCases({ first: 10, after: 'broken' });

    expect(codesOf(response)).toEqual(['invalid_cursor']);
  });
});

describe('adminReportCase', () => {
  test('案件・照会・通報と申出者を受付日時の昇順で返し、連絡先は有無だけを返す', async () => {
    const response = await fetchReportCase(caseIdOf(PRODUCT_CASE));

    expect(response.errors).toBeUndefined();
    expect(response.data?.adminReportCase).toEqual({
      case: PRODUCT_CASE_NODE,
      statusChangedAt: hoursAfterT0(1).toISOString(),
      resolution: null,
      closingReason: null,
      closedAt: null,
      lastInquiry: {
        sentAt: hoursAfterT0(1).toISOString(),
        message: LAST_INQUIRY_MESSAGE,
        deadline: new Date(
          hoursAfterT0(1).getTime() + INQUIRY_RESPONSE_MS,
        ).toISOString(),
        overdue: false,
      },
      inquiryAvailable: true,
      reports: [
        {
          id: reportIdOf(1),
          categoryName: REPORT_CATEGORY_INFRINGEMENT_NAME,
          reason: '申出者の理由1',
          reportedAt: T0.toISOString(),
          reporter: {
            kind: 'member',
            nickname: '申出者1',
            handle: 'rcwreporter1',
            hasContact: false,
          },
        },
        {
          id: reportIdOf(2),
          categoryName: REPORT_CATEGORY_OTHER_NAME,
          reason: '申出者の理由2',
          reportedAt: hoursAfterT0(3).toISOString(),
          reporter: {
            kind: 'guest',
            nickname: null,
            handle: null,
            hasContact: true,
          },
        },
      ],
    });
  });

  test('完了した案件は完了の理由と日時を返し、照会できない', async () => {
    const response = await fetchReportCase(caseIdOf(USER_CASE));

    expect(response.data?.adminReportCase).toMatchObject({
      case: {
        status: 'REJECTED',
        target: { kind: 'USER', id: userIdOf(OWNER), handle: 'user1' },
      },
      resolution: null,
      closingReason: '前の却下の理由',
      closedAt: T0.toISOString(),
      lastInquiry: null,
      inquiryAvailable: false,
    });
  });

  test('対象への参照を消した案件は、対象のIDをnullにしてdetachedを真で返す', async () => {
    const response = await fetchReportCase(caseIdOf(DETACHED_CASE));

    expect(response.data?.adminReportCase).toMatchObject({
      case: { target: { id: null, detached: true, available: false } },
      inquiryAvailable: false,
    });
  });

  test('無い案件はnullを返す', async () => {
    const response = await fetchReportCase(MISSING_CASE_ID);

    expect(response.errors).toBeUndefined();
    expect(response.data?.adminReportCase).toBeNull();
  });

  test('形式の違うIDをvalidation_errorで拒否する', async () => {
    const response = await fetchReportCase('not-a-ulid');

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response).map((detail) => detail.field)).toEqual(['id']);
  });
});
