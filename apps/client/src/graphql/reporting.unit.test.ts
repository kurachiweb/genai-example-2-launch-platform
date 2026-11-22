import { describe, expect, test } from 'bun:test';
import { MutationObserver, QueryClient } from '@tanstack/react-query';

import {
  graphqlResponse,
  htmlResponse,
  recordingApi,
  renderContextOf,
  runInStartRequest,
} from '../../lib/test/start-request-fixtures.ts';
import { documentIdOf } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  REPORT_CATEGORY_INFRINGEMENT_ID,
  REPORT_CATEGORY_OTHER_ID,
} from '../../common-lib/reporting/report-rules.ts';
import {
  ClientReportCategoriesDocument,
  type ClientReportCategoriesQuery,
  ClientSubmitReportDocument,
} from './generated/graphql.ts';
import {
  reportCategoriesQueryOptions,
  submitReportMutationOptions,
  toReportCategoryOptions,
  toSubmitReportVariables,
} from './reporting.ts';

const CATEGORIES: ClientReportCategoriesQuery = {
  reportCategories: [
    {
      id: REPORT_CATEGORY_INFRINGEMENT_ID,
      name: '権利侵害',
      infringement: true,
    },
    { id: '01JE0000000000000000000010', name: 'スパム', infringement: false },
    { id: REPORT_CATEGORY_OTHER_ID, name: 'その他', infringement: false },
  ],
};

interface SentRequest {
  readonly documentId: string;
  readonly variables: unknown;
}

// 外部へ通信しないよう、描画の文脈のAPIを偽物にしてサーバーの分岐で実行し、APIへ送った識別子と変数を読み取る
const runThroughApi = async (
  run: (queryClient: QueryClient) => Promise<unknown>,
  data: unknown,
) => {
  const api = recordingApi(() => Promise.resolve(graphqlResponse({ data })));
  let result: unknown;
  await runInStartRequest({
    context: renderContextOf({ api, reported: [] }),
    render: async () => {
      result = await run(new QueryClient());
      return htmlResponse();
    },
  });
  const sent = await Promise.all(
    api.requests.map((request) => request.json() as Promise<SentRequest>),
  );
  return { result, sent };
};

describe('reportCategoriesQueryOptions', () => {
  test('カテゴリは閲覧者によらないため、操作の識別子と空の変数だけのキーにして複数のダイアログの取得を1つにまとめる', () => {
    expect([...reportCategoriesQueryOptions().queryKey]).toStrictEqual([
      documentIdOf(ClientReportCategoriesDocument),
      {},
    ]);
  });

  test('カテゴリの照会を変数なしで実行し、応答のデータを返す', async () => {
    const { result, sent } = await runThroughApi(
      (queryClient) => queryClient.query(reportCategoriesQueryOptions()),
      CATEGORIES,
    );

    expect(result).toStrictEqual(CATEGORIES);
    expect(sent).toStrictEqual([
      {
        documentId: documentIdOf(ClientReportCategoriesDocument),
        variables: {},
      },
    ]);
  });
});

describe('toReportCategoryOptions', () => {
  test('応答の順のまま、カテゴリのID・名前・権利侵害の印を取り出す', () => {
    expect(toReportCategoryOptions(CATEGORIES)).toStrictEqual([
      {
        id: REPORT_CATEGORY_INFRINGEMENT_ID,
        name: '権利侵害',
        infringement: true,
      },
      { id: '01JE0000000000000000000010', name: 'スパム', infringement: false },
      { id: REPORT_CATEGORY_OTHER_ID, name: 'その他', infringement: false },
    ]);
  });
});

describe('toSubmitReportVariables', () => {
  test.each([
    ['user', 'USER'],
    ['product', 'PRODUCT'],
    ['comment', 'COMMENT'],
  ] as const)(
    '対象の種類%sをGraphQLの列挙の%sにし、連絡先が無ければ入力に含めない',
    (targetKind, expected) => {
      expect(
        toSubmitReportVariables({
          targetKind,
          targetRef: 'pitch_maker',
          categoryId: REPORT_CATEGORY_OTHER_ID,
          reason: '迷惑な投稿を繰り返しています。',
        }),
      ).toStrictEqual({
        input: {
          targetKind: expected,
          targetRef: 'pitch_maker',
          categoryId: REPORT_CATEGORY_OTHER_ID,
          reason: '迷惑な投稿を繰り返しています。',
        },
      });
    },
  );

  test('連絡先があれば入力に含める', () => {
    expect(
      toSubmitReportVariables({
        targetKind: 'product',
        targetRef: '01JF0000000000000000000001',
        categoryId: REPORT_CATEGORY_INFRINGEMENT_ID,
        reason: '私の作品の画像が無断で使われています。',
        contactEmail: 'owner@example.example',
      }).input.contactEmail,
    ).toBe('owner@example.example');
  });
});

describe('submitReportMutationOptions', () => {
  test('変更のキーは操作の識別子だけにする', () => {
    expect(submitReportMutationOptions().mutationKey).toStrictEqual([
      documentIdOf(ClientSubmitReportDocument),
    ]);
  });

  test('入力を変数にして通報の送信を実行し、受け付けの結果を返す', async () => {
    const data = { submitReport: { accepted: true } };
    const variables = toSubmitReportVariables({
      targetKind: 'comment',
      targetRef: '01JG0000000000000000000001',
      categoryId: REPORT_CATEGORY_OTHER_ID,
      reason: '誹謗中傷を含んでいます。',
    });

    const { result, sent } = await runThroughApi(
      (queryClient) =>
        new MutationObserver(queryClient, submitReportMutationOptions()).mutate(
          { variables, turnstileToken: 'turnstile-token' },
        ),
      data,
    );

    expect(result).toStrictEqual(data);
    expect(sent).toStrictEqual([
      { documentId: documentIdOf(ClientSubmitReportDocument), variables },
    ]);
  });
});
