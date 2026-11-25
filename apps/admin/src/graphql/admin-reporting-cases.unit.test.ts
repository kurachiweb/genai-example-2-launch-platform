import { describe, expect, test } from 'bun:test';
import { QueryClient, type QueryKey } from '@tanstack/react-query';
import { isNotFound } from '@tanstack/react-router';

import { REPORT_LIST_PAGE_SIZE } from '../../common-lib/reporting/report-case-rules.ts';
import { GraphQLClientError } from '../../lib/utilities/graphql/graphql-result.ts';
import {
  documentIdOf,
  graphqlQueryKey,
} from '../../lib/utilities/graphql/persisted-document.ts';
import {
  dataResponse,
  runThroughApi,
  unavailableResponse,
} from '../../test/moderation-graphql-api.ts';
import {
  adminReportCaseQueryOptions,
  adminReportCasesQueryOptions,
  changeReportCaseStatusMutationOptions,
  invalidateReportCaseQueries,
  loadReportCasePage,
  loadReportCasesPage,
  reportCaseClosingMutationOptions,
  sendInfringementInquiryMutationOptions,
  toReportCaseDetail,
  toReportCasePage,
} from './admin-reporting-cases.ts';
import { adminReportCategoriesQueryOptions } from './admin-reporting-categories.ts';
import {
  AdminChangeReportCaseStatusDocument,
  AdminRejectReportCaseDocument,
  AdminReportCaseDocument,
  type AdminReportCaseQuery,
  AdminReportCasesDocument,
  type AdminReportCaseSummaryFragment,
  AdminResolveReportCaseWithMeasureDocument,
  AdminResolveReportCaseWithoutMeasureDocument,
  AdminSendInfringementInquiryDocument,
  AdminUnhandledReportSummaryDocument,
} from './generated/graphql.ts';

const CASE_ID = '01JE0CASE00000000000000001';
const OTHER_CASE_ID = '01JE0CASE00000000000000002';
const PRODUCT_ID = '01JE0PRDCT0000000000000001';
const COMMENT_ID = '01JE0CMMNT0000000000000001';
const CATEGORY_ID = '01JE0000000000000000000001';
const OTHER_CATEGORY_ID = '01JE0000000000000000000002';
const REPORT_ID = '01JE0RPRT00000000000000001';
const GUEST_REPORT_ID = '01JE0RPRT00000000000000002';

const COMMENT_CASE: AdminReportCaseSummaryFragment = {
  id: CASE_ID,
  target: {
    kind: 'COMMENT',
    id: COMMENT_ID,
    detached: false,
    available: true,
    handle: null,
    label: null,
    excerpt: '抜粋の本文',
    productId: PRODUCT_ID,
    productName: 'ピッチデッキ',
    productHandle: 'pitch_deck',
  },
  status: 'IN_PROGRESS',
  reportCount: 3,
  categoryCounts: [
    { categoryId: CATEGORY_ID, name: '権利侵害', count: 2 },
    { categoryId: OTHER_CATEGORY_ID, name: 'その他', count: 1 },
  ],
  firstReportedAt: '2026-11-01T00:00:00.000Z',
  lastReportedAt: '2026-11-03T00:00:00.000Z',
  infringement: true,
  responseTime: {
    startedAt: '2026-11-01T00:00:00.000Z',
    completedAt: null,
    elapsedSeconds: 7200,
    alerts: ['START_OVERDUE', 'DECISION_OVERDUE'],
  },
};

const DETACHED_USER_CASE: AdminReportCaseSummaryFragment = {
  id: OTHER_CASE_ID,
  target: {
    kind: 'USER',
    id: null,
    detached: true,
    available: false,
    handle: null,
    label: null,
    excerpt: null,
    productId: null,
    productName: null,
    productHandle: null,
  },
  status: 'REJECTED',
  reportCount: 1,
  categoryCounts: [{ categoryId: OTHER_CATEGORY_ID, name: 'その他', count: 1 }],
  firstReportedAt: '2026-10-01T00:00:00.000Z',
  lastReportedAt: '2026-10-01T00:00:00.000Z',
  infringement: false,
  responseTime: null,
};

type Detail = NonNullable<AdminReportCaseQuery['adminReportCase']>;

const DETAIL: Detail = {
  case: COMMENT_CASE,
  statusChangedAt: '2026-11-02T00:00:00.000Z',
  resolution: null,
  closingReason: null,
  closedAt: null,
  lastInquiry: {
    sentAt: '2026-11-02T01:00:00.000Z',
    message: '権利の根拠をお知らせください。',
    deadline: '2026-11-09T01:00:00.000Z',
    overdue: false,
  },
  inquiryAvailable: true,
  reports: [
    {
      id: REPORT_ID,
      categoryName: '権利侵害',
      reason: '<b>無断転載</b>です',
      reportedAt: '2026-11-01T00:00:00.000Z',
      reporter: {
        kind: 'member',
        nickname: 'メーカーAI',
        handle: 'maker_ai',
        hasContact: false,
      },
    },
    {
      id: GUEST_REPORT_ID,
      categoryName: 'その他',
      reason: '不快です',
      reportedAt: '2026-11-03T00:00:00.000Z',
      reporter: {
        kind: 'guest',
        nickname: null,
        handle: null,
        hasContact: true,
      },
    },
  ],
};

const casesResponse = (
  nodes: AdminReportCaseSummaryFragment[],
  endCursor: string | null = null,
) => ({
  adminReportCases: {
    nodes,
    pageInfo: { hasNextPage: endCursor !== null, endCursor },
  },
});

const malformedIdResponse = (): Promise<Response> =>
  Promise.resolve(
    new Response(
      JSON.stringify({
        errors: [
          {
            message: '入力内容に誤りがあります。',
            extensions: {
              code: 'validation_error',
              details: [
                {
                  field: 'id',
                  code: 'invalid_format',
                  message: '通報の案件が見つかりません。',
                },
              ],
            },
          },
        ],
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/graphql-response+json' },
      },
    ),
  );

const onlyCaseOf = (data: ReturnType<typeof casesResponse>) => {
  const [item] = toReportCasePage(data).items;
  if (item === undefined) {
    throw new Error('案件の例が無い');
  }
  return item;
};

describe('adminReportCasesQueryOptions', () => {
  test('小文字の絞り込みをGraphQLの列挙へ写し、1ページの件数とページの位置を変数にする', () => {
    expect([
      ...adminReportCasesQueryOptions({
        status: 'in_progress',
        targetKind: 'comment',
        categoryId: CATEGORY_ID,
        reportedFrom: '2026-10-31T15:00:00.000Z',
        reportedBefore: '2026-11-30T15:00:00.000Z',
        after: 'cursor-1',
      }).queryKey,
    ]).toStrictEqual([
      ...graphqlQueryKey(AdminReportCasesDocument, {
        filter: {
          status: 'IN_PROGRESS',
          targetKind: 'COMMENT',
          categoryId: CATEGORY_ID,
          reportedFrom: '2026-10-31T15:00:00.000Z',
          reportedBefore: '2026-11-30T15:00:00.000Z',
        },
        first: REPORT_LIST_PAGE_SIZE,
        after: 'cursor-1',
      }),
    ]);
  });

  test('未指定の項目は変数に含めず、1ページは50件以下にする', () => {
    expect([...adminReportCasesQueryOptions({}).queryKey]).toStrictEqual([
      ...graphqlQueryKey(AdminReportCasesDocument, {
        filter: {},
        first: REPORT_LIST_PAGE_SIZE,
      }),
    ]);
    expect(REPORT_LIST_PAGE_SIZE).toBeLessThanOrEqual(50);
  });
});

describe('adminReportCaseQueryOptions', () => {
  test('案件のIDを変数にする', () => {
    expect([...adminReportCaseQueryOptions(CASE_ID).queryKey]).toStrictEqual([
      ...graphqlQueryKey(AdminReportCaseDocument, { id: CASE_ID }),
    ]);
  });
});

describe('toReportCasePage', () => {
  test('列挙を共用部品の小文字の値へ写し、続きがあれば次のページの位置を返す', () => {
    expect(
      toReportCasePage(casesResponse([COMMENT_CASE], 'cursor-2')),
    ).toStrictEqual({
      items: [
        {
          id: CASE_ID,
          target: {
            kind: 'comment',
            id: COMMENT_ID,
            detached: false,
            available: true,
            handle: null,
            label: null,
            excerpt: '抜粋の本文',
            productId: PRODUCT_ID,
            productName: 'ピッチデッキ',
            productHandle: 'pitch_deck',
          },
          status: 'in_progress',
          reportCount: 3,
          categoryCounts: [
            { categoryId: CATEGORY_ID, name: '権利侵害', count: 2 },
            { categoryId: OTHER_CATEGORY_ID, name: 'その他', count: 1 },
          ],
          firstReportedAt: '2026-11-01T00:00:00.000Z',
          lastReportedAt: '2026-11-03T00:00:00.000Z',
          infringement: true,
          responseTime: {
            startedAt: '2026-11-01T00:00:00.000Z',
            completedAt: null,
            elapsedSeconds: 7200,
            alerts: ['start-overdue', 'decision-overdue'],
          },
        },
      ],
      nextCursor: 'cursor-2',
    });
  });

  test('対象への参照を消した案件はIDがnullのまま、権利侵害でない案件は対応期間がnullのまま写し、続きが無ければ位置はnull', () => {
    const page = toReportCasePage(casesResponse([DETACHED_USER_CASE]));

    expect(page.nextCursor).toBeNull();
    expect(page.items[0]).toMatchObject({
      id: OTHER_CASE_ID,
      target: { kind: 'user', id: null, detached: true, available: false },
      status: 'rejected',
      responseTime: null,
    });
  });

  test.each([
    ['OPEN', 'open'],
    ['IN_PROGRESS', 'in_progress'],
    ['RESOLVED', 'resolved'],
    ['REJECTED', 'rejected'],
  ] as const)('状態%sを%sへ写す', (status, expected) => {
    expect(
      toReportCasePage(casesResponse([{ ...COMMENT_CASE, status }])).items[0]
        ?.status,
    ).toBe(expected);
  });

  test.each([
    ['USER', 'user'],
    ['PRODUCT', 'product'],
    ['COMMENT', 'comment'],
  ] as const)('対象の種類%sを%sへ写す', (kind, expected) => {
    expect(
      toReportCasePage(
        casesResponse([
          { ...COMMENT_CASE, target: { ...COMMENT_CASE.target, kind } },
        ]),
      ).items[0]?.target.kind,
    ).toBe(expected);
  });
});

describe('toReportCaseDetail', () => {
  test('詳細の項目と通報の一覧を写し、申出者の種類はログイン中と未ログインを区別する', () => {
    const detail = toReportCaseDetail({ adminReportCase: DETAIL });

    expect(detail).toStrictEqual({
      case: onlyCaseOf(casesResponse([COMMENT_CASE])),
      statusChangedAt: '2026-11-02T00:00:00.000Z',
      resolution: null,
      closingReason: null,
      closedAt: null,
      lastInquiry: {
        sentAt: '2026-11-02T01:00:00.000Z',
        message: '権利の根拠をお知らせください。',
        deadline: '2026-11-09T01:00:00.000Z',
        overdue: false,
      },
      inquiryAvailable: true,
      reports: [
        {
          id: REPORT_ID,
          categoryName: '権利侵害',
          reason: '<b>無断転載</b>です',
          reportedAt: '2026-11-01T00:00:00.000Z',
          reporter: {
            kind: 'member',
            nickname: 'メーカーAI',
            handle: 'maker_ai',
            hasContact: false,
          },
        },
        {
          id: GUEST_REPORT_ID,
          categoryName: 'その他',
          reason: '不快です',
          reportedAt: '2026-11-03T00:00:00.000Z',
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

  test.each([
    ['PRODUCT_HIDE', 'product.hide'],
    ['COMMENT_HIDE', 'comment.hide'],
    ['USER_SUSPEND', 'user.suspend'],
    ['NONE', 'none'],
  ] as const)('完了の種類%sを%sへ写す', (resolution, expected) => {
    expect(
      toReportCaseDetail({
        adminReportCase: {
          ...DETAIL,
          resolution,
          closingReason: '対応しました',
          closedAt: '2026-11-04T00:00:00.000Z',
          lastInquiry: null,
        },
      }),
    ).toMatchObject({
      resolution: expected,
      closingReason: '対応しました',
      closedAt: '2026-11-04T00:00:00.000Z',
      lastInquiry: null,
    });
  });

  test('画面が知らない申出者の種類はnullにする', () => {
    const [report] = DETAIL.reports;
    if (report === undefined) {
      throw new Error('通報の例が無い');
    }

    expect(
      toReportCaseDetail({
        adminReportCase: {
          ...DETAIL,
          reports: [
            { ...report, reporter: { ...report.reporter, kind: 'robot' } },
          ],
        },
      })?.reports[0]?.reporter.kind,
    ).toBeNull();
  });

  test('不在の案件はnullにする', () => {
    expect(toReportCaseDetail({ adminReportCase: null })).toBeNull();
  });
});

describe('changeReportCaseStatusMutationOptions', () => {
  test('小文字の状態をGraphQLの列挙にして実行し、変更後の状態を小文字で返す', async () => {
    const options = changeReportCaseStatusMutationOptions();
    const { result, sent } = await runThroughApi(
      () =>
        options.mutationFn({
          variables: {
            caseId: CASE_ID,
            from: 'resolved',
            to: 'in_progress',
            reason: '再確認する',
          },
        }),
      dataResponse({ changeReportCaseStatus: { status: 'IN_PROGRESS' } }),
    );

    expect(options.mutationKey).toStrictEqual([
      documentIdOf(AdminChangeReportCaseStatusDocument),
    ]);
    expect(sent).toStrictEqual([
      {
        documentId: documentIdOf(AdminChangeReportCaseStatusDocument),
        variables: {
          id: CASE_ID,
          from: 'RESOLVED',
          to: 'IN_PROGRESS',
          reason: '再確認する',
        },
      },
    ]);
    expect(result).toStrictEqual({ status: 'in_progress' });
  });

  test('理由が無ければ変数に含めない', async () => {
    const { sent } = await runThroughApi(
      () =>
        changeReportCaseStatusMutationOptions().mutationFn({
          variables: { caseId: CASE_ID, from: 'open', to: 'in_progress' },
        }),
      dataResponse({ changeReportCaseStatus: { status: 'IN_PROGRESS' } }),
    );

    expect(sent[0]?.variables).toStrictEqual({
      id: CASE_ID,
      from: 'OPEN',
      to: 'IN_PROGRESS',
    });
  });
});

describe('reportCaseClosingMutationOptions', () => {
  test.each([
    [
      'resolve-with-measure',
      documentIdOf(AdminResolveReportCaseWithMeasureDocument),
      { resolveReportCaseWithMeasure: { status: 'RESOLVED' } },
      'resolved',
    ],
    [
      'resolve-without-measure',
      documentIdOf(AdminResolveReportCaseWithoutMeasureDocument),
      { resolveReportCaseWithoutMeasure: { status: 'RESOLVED' } },
      'resolved',
    ],
    [
      'reject',
      documentIdOf(AdminRejectReportCaseDocument),
      { rejectReportCase: { status: 'REJECTED' } },
      'rejected',
    ],
  ] as const)(
    '%sは案件と理由を操作の変数にして実行し、変更後の状態を小文字で返す',
    async (operation, documentId, data, status) => {
      const options = reportCaseClosingMutationOptions(operation);
      const { result, sent } = await runThroughApi(
        () =>
          options.mutationFn({
            variables: { caseId: CASE_ID, reason: '規約違反' },
          }),
        dataResponse(data),
      );

      expect(options.mutationKey).toStrictEqual([documentId]);
      expect(sent).toStrictEqual([
        { documentId, variables: { id: CASE_ID, reason: '規約違反' } },
      ]);
      expect(result).toStrictEqual({ status });
    },
  );
});

describe('sendInfringementInquiryMutationOptions', () => {
  test('案件と内容と理由を操作の変数にして実行し、送信の日時と期限を返す', async () => {
    const options = sendInfringementInquiryMutationOptions();
    const outcome = {
      sentAt: '2026-11-02T01:00:00.000Z',
      deadline: '2026-11-09T01:00:00.000Z',
    };
    const { result, sent } = await runThroughApi(
      () =>
        options.mutationFn({
          variables: {
            caseId: CASE_ID,
            message: '権利の根拠をお知らせください。',
            reason: '申出の確認',
          },
        }),
      dataResponse({ sendInfringementInquiry: outcome }),
    );

    expect(options.mutationKey).toStrictEqual([
      documentIdOf(AdminSendInfringementInquiryDocument),
    ]);
    expect(sent).toStrictEqual([
      {
        documentId: documentIdOf(AdminSendInfringementInquiryDocument),
        variables: {
          id: CASE_ID,
          message: '権利の根拠をお知らせください。',
          reason: '申出の確認',
        },
      },
    ]);
    expect(result).toStrictEqual(outcome);
  });

  test('理由が無ければ変数に含めない', async () => {
    const { sent } = await runThroughApi(
      () =>
        sendInfringementInquiryMutationOptions().mutationFn({
          variables: { caseId: CASE_ID, message: '内容' },
        }),
      dataResponse({
        sendInfringementInquiry: {
          sentAt: '2026-11-02T01:00:00.000Z',
          deadline: '2026-11-09T01:00:00.000Z',
        },
      }),
    );

    expect(sent[0]?.variables).toStrictEqual({ id: CASE_ID, message: '内容' });
  });
});

describe('invalidateReportCaseQueries', () => {
  test('条件とページの位置を問わず案件の一覧と、全ての案件の詳細の取得を無効にし、他の取得は残す', async () => {
    const queryClient = new QueryClient();
    const keys: readonly QueryKey[] = [
      adminReportCasesQueryOptions({}).queryKey,
      adminReportCasesQueryOptions({ status: 'open', after: 'cursor-1' })
        .queryKey,
      adminReportCaseQueryOptions(CASE_ID).queryKey,
      adminReportCaseQueryOptions(OTHER_CASE_ID).queryKey,
    ];
    const otherKeys: readonly QueryKey[] = [
      adminReportCategoriesQueryOptions().queryKey,
      graphqlQueryKey(AdminUnhandledReportSummaryDocument, {}),
    ];
    for (const key of [...keys, ...otherKeys]) {
      queryClient.setQueryData(key, {});
    }

    await invalidateReportCaseQueries(queryClient);

    for (const key of keys) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    }
    for (const key of otherKeys) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);
    }
  });
});

describe('loadReportCasesPage', () => {
  test('一覧と、絞り込みのカテゴリの選択肢を同時に取得する', async () => {
    const { sent } = await runThroughApi(
      (queryClient) =>
        loadReportCasesPage({
          context: { queryClient },
          deps: { status: 'open' },
          cause: 'enter',
        }),
      dataResponse({ ...casesResponse([]), adminReportCategories: [] }),
    );

    expect(sent).toStrictEqual([
      {
        documentId: documentIdOf(AdminReportCasesDocument),
        variables: { filter: { status: 'OPEN' }, first: REPORT_LIST_PAGE_SIZE },
      },
      {
        documentId: adminReportCategoriesQueryOptions().queryKey[0],
        variables: {},
      },
    ]);
  });

  test('取得に失敗しても、一覧と絞り込みの中で再試行できるよう例外にせず失敗をキャッシュに残す', async () => {
    const { result, queryClient } = await runThroughApi(
      (client) =>
        loadReportCasesPage({
          context: { queryClient: client },
          deps: {},
          cause: 'enter',
        }),
      unavailableResponse,
    );

    expect(result).toBeUndefined();
    expect(
      queryClient.getQueryState(adminReportCasesQueryOptions({}).queryKey)
        ?.status,
    ).toBe('error');
    expect(
      queryClient.getQueryState(adminReportCategoriesQueryOptions().queryKey)
        ?.status,
    ).toBe('error');
  });

  test.each(['enter', 'preload'] as const)(
    '%sの読み込みは取得の終わりを待つ',
    async (cause) => {
      const { result } = await runThroughApi(
        async (queryClient) => {
          await loadReportCasesPage({
            context: { queryClient },
            deps: {},
            cause,
          });
          return queryClient.getQueryState(
            adminReportCasesQueryOptions({}).queryKey,
          )?.fetchStatus;
        },
        dataResponse({ ...casesResponse([]), adminReportCategories: [] }),
      );

      expect(result).toBe('idle');
    },
  );

  test('同じ画面の中の条件の変更とページの移動(stay)は、直前の一覧を残して読み込み中を示せるよう、取得を始めるだけで待たない', async () => {
    const { result } = await runThroughApi(
      async (queryClient) => {
        await loadReportCasesPage({
          context: { queryClient },
          deps: {},
          cause: 'stay',
        });
        const fetchStatus = queryClient.getQueryState(
          adminReportCasesQueryOptions({}).queryKey,
        )?.fetchStatus;
        await queryClient.query(adminReportCasesQueryOptions({}));
        return fetchStatus;
      },
      dataResponse({ ...casesResponse([]), adminReportCategories: [] }),
    );

    expect(result).toBe('fetching');
  });
});

describe('loadReportCasePage', () => {
  test('案件の詳細を取得してキャッシュに置く', async () => {
    const { result, sent } = await runThroughApi(
      async (queryClient) => {
        await loadReportCasePage({
          context: { queryClient },
          params: { caseId: CASE_ID },
        });
        return queryClient.getQueryData(
          adminReportCaseQueryOptions(CASE_ID).queryKey,
        );
      },
      dataResponse({ adminReportCase: DETAIL }),
    );

    expect(sent).toStrictEqual([
      {
        documentId: documentIdOf(AdminReportCaseDocument),
        variables: { id: CASE_ID },
      },
    ]);
    expect(result).toStrictEqual({ adminReportCase: DETAIL });
  });

  test('不在の案件と、IDの形式の違反は見つからない扱いにする', async () => {
    const missing = await runThroughApi(
      (queryClient) =>
        loadReportCasePage({
          context: { queryClient },
          params: { caseId: CASE_ID },
        }).catch((error: unknown) => error),
      dataResponse({ adminReportCase: null }),
    );
    const malformed = await runThroughApi(
      (queryClient) =>
        loadReportCasePage({
          context: { queryClient },
          params: { caseId: 'not-a-ulid' },
        }).catch((error: unknown) => error),
      malformedIdResponse,
    );

    expect(isNotFound(missing.result)).toBe(true);
    expect(isNotFound(malformed.result)).toBe(true);
  });

  test('詳細の取得の他の失敗は、詳細が無ければページを表示できないためルートのエラーの画面に任せる', async () => {
    const { result } = await runThroughApi(
      (queryClient) =>
        loadReportCasePage({
          context: { queryClient },
          params: { caseId: CASE_ID },
        }).catch((error: unknown) => error),
      unavailableResponse,
    );

    expect(result).toBeInstanceOf(GraphQLClientError);
  });
});
