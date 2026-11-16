import {
  type QueryClient,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { Toaster } from '../../../lib/components/feedback/toaster.tsx';
import {
  errorMessageOf,
  GraphQLClientError,
} from '../../../lib/utilities/graphql/graphql-result.ts';
import {
  createPageRouterContext,
  renderInRouter,
} from '../../../test/page-router.tsx';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import {
  launchCommentCountsQueryOptions,
  launchCommentsQueryOptions,
  productRatingQueryOptions,
} from '../../graphql/engagement.ts';
import {
  ClientDeleteCommentDocument,
  ClientLaunchCommentCountsDocument,
  ClientLaunchCommentsDocument,
  ClientPostCommentDocument,
  ClientUpdateCommentDocument,
  type ClientLaunchCommentsQuery,
  type LaunchCommentFragment,
  type ProductRatingFragment,
} from '../../graphql/generated/graphql.ts';
import type { CommentSubmission } from './comment-composer.tsx';
import { useCommentMutations } from './use-comment-mutations.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const VIEWER_ID = '01JC0VIEWER0000000000000000';

const PRODUCT_ID = '01JC0PRODUCT00000000000000';

const LAUNCH_ID = '01JC0LAUNCH000000000000000';

const ROOT_ID = '01JC0COMMENT0000000000000A';

const REPLY_ID = '01JC0COMMENT0000000000000B';

const NEW_ID = '01JC0COMMENT0000000000000C';

const OLDER_ID = '01JC0COMMENT0000000000000D';

const TOKEN = 'turnstile-token';

const commentOf = (
  id: string,
  overrides: Partial<LaunchCommentFragment> = {},
): LaunchCommentFragment => ({
  id,
  parentId: null,
  depth: 1,
  state: 'SHOWN',
  author: { handle: 'pitch_maker', nickname: 'ピッチの作り手', avatar: null },
  body: `${id}の本文`,
  createdAt: '2026-11-10T03:00:00.000Z',
  edited: false,
  byProductOwner: false,
  viewerIsAuthor: true,
  ...overrides,
});

const ROOT = commentOf(ROOT_ID);

const REPLY = commentOf(REPLY_ID, { parentId: ROOT_ID, depth: 2 });

const firstPage = (): ClientLaunchCommentsQuery => ({
  launchComments: {
    nodes: [{ comment: ROOT, replies: [REPLY] }],
    pageInfo: { endCursor: 'cursor-1', hasNextPage: true },
  },
});

const secondPage = (): ClientLaunchCommentsQuery => ({
  launchComments: {
    nodes: [{ comment: commentOf(OLDER_ID), replies: [] }],
    pageInfo: { endCursor: 'cursor-2', hasNextPage: false },
  },
});

const ratingOf = (
  overrides: Partial<ProductRatingFragment> = {},
): ProductRatingFragment => ({
  productId: PRODUCT_ID,
  average: 4,
  count: 3,
  viewerScore: null,
  ...overrides,
});

const RATED = ratingOf({ average: 4.25, count: 4, viewerScore: 5 });

const INTERNAL_ERROR = new GraphQLClientError({
  code: 'internal_error',
  message: 'サーバーでエラーが発生しました。',
  status: 500,
});

const PARENT_UNAVAILABLE = new GraphQLClientError({
  code: 'comment_parent_unavailable',
  message: '返信先のコメントが見つかりません。削除された可能性があります。',
  status: 422,
});

type Responder = (variables: Record<string, unknown>) => unknown;

const resultOf = (value: unknown) =>
  Promise.resolve(
    value instanceof Error
      ? { ok: false, error: value }
      : { ok: true, data: value },
  );

let countResponses: number[] = [];

const respondWith = (mutations: ReadonlyMap<unknown, Responder>) => {
  let countCalls = 0;
  executeGraphQL.mockImplementation(
    (document: unknown, variables: Record<string, unknown>) => {
      if (document === ClientLaunchCommentsDocument) {
        return resultOf(
          variables['after'] === undefined ? firstPage() : secondPage(),
        );
      }
      if (document === ClientLaunchCommentCountsDocument) {
        const count = countResponses[countCalls] ?? countResponses.at(-1) ?? 0;
        countCalls += 1;
        return resultOf({
          launchCommentCounts: [{ launchId: LAUNCH_ID, count }],
        });
      }
      const respond = mutations.get(document);
      return respond === undefined
        ? Promise.reject(new Error('想定外の操作です。'))
        : resultOf(respond(variables));
    },
  );
};

const callsOf = (document: unknown) =>
  executeGraphQL.mock.calls
    .filter(([called]) => called === document)
    .map(([, variables, options]) => ({
      variables: variables as Record<string, unknown>,
      options: options as Record<string, unknown> | undefined,
    }));

const submissionOf = (rating?: 1 | 2 | 3 | 4 | 5): CommentSubmission => ({
  body: '新しい本文',
  turnstileToken: TOKEN,
  ...(rating === undefined ? {} : { rating }),
});

function MutationsHarness() {
  const [failure, setFailure] = useState<string>();
  const mutations = useCommentMutations({
    productId: PRODUCT_ID,
    launchId: LAUNCH_ID,
    viewerId: VIEWER_ID,
  });
  const threads = useInfiniteQuery(
    launchCommentsQueryOptions(VIEWER_ID, PRODUCT_ID, LAUNCH_ID),
  );
  const counts = useQuery(
    launchCommentCountsQueryOptions(VIEWER_ID, PRODUCT_ID),
  );
  const comments = (threads.data?.pages ?? []).flatMap(
    ({ launchComments }) =>
      launchComments?.nodes.flatMap(({ comment, replies }) => [
        comment,
        ...replies,
      ]) ?? [],
  );
  const count = counts.data?.launchCommentCounts?.find(
    ({ launchId }) => launchId === LAUNCH_ID,
  )?.count;

  const run = (operation: () => Promise<void>) => () => {
    setFailure(undefined);
    operation().catch((error: unknown) => {
      setFailure(errorMessageOf(error, CLIENT_PROFILE.contactAvailable));
    });
  };

  return (
    <main className="bg-background p-4 text-foreground">
      <p data-testid="count">{count === undefined ? '件数なし' : count}</p>
      <ol aria-label="コメント">
        {comments.map((comment) => (
          <li key={comment.id}>
            {comment.state === 'REMOVED'
              ? `${comment.id}:削除済み`
              : `${comment.id}:${comment.body ?? ''}`}
          </li>
        ))}
      </ol>
      <button type="button" onClick={() => void threads.fetchNextPage()}>
        続きを読む
      </button>
      <button type="button" onClick={run(() => mutations.post(submissionOf()))}>
        投稿
      </button>
      <button
        type="button"
        onClick={run(() => mutations.post(submissionOf(5)))}
      >
        評価を添えて投稿
      </button>
      <button
        type="button"
        onClick={run(() => mutations.reply(REPLY_ID, submissionOf()))}
      >
        返信
      </button>
      <button
        type="button"
        onClick={run(() => mutations.update(ROOT_ID, submissionOf()))}
      >
        編集
      </button>
      <button
        type="button"
        onClick={run(() => mutations.update(ROOT_ID, submissionOf(5)))}
      >
        評価を添えて編集
      </button>
      <button
        type="button"
        onClick={run(() => mutations.remove(REPLY_ID, TOKEN))}
      >
        削除
      </button>
      {failure === undefined ? null : <p role="alert">{failure}</p>}
    </main>
  );
}

const renderHarness = async (
  mutations: ReadonlyMap<unknown, Responder>,
): Promise<QueryClient> => {
  respondWith(mutations);
  const context = createPageRouterContext('local');
  context.queryClient.setQueryData(
    productRatingQueryOptions(VIEWER_ID, PRODUCT_ID).queryKey,
    { productRating: ratingOf() },
  );
  await renderInRouter(
    <>
      <MutationsHarness />
      <Toaster />
    </>,
    { context, cachedViewer: signedInViewerQuery() },
  );
  await expect.element(item(ROOT_ID)).toBeInTheDocument();
  await expect.element(count()).toHaveTextContent('2');
  return context.queryClient;
};

const list = () => page.getByRole('list', { name: 'コメント' });

const item = (id: string) => list().getByText(new RegExp(`^${id}:`, 'u'));

const count = () => page.getByTestId('count');

const press = (name: string) =>
  userEvent.click(page.getByRole('button', { name, exact: true }));

const toastText = (text: string) => page.getByText(text, { exact: true });

const threadsKey = () =>
  launchCommentsQueryOptions(VIEWER_ID, PRODUCT_ID, LAUNCH_ID).queryKey;

const ratingKey = () =>
  productRatingQueryOptions(VIEWER_ID, PRODUCT_ID).queryKey;

const listedIds = () =>
  list()
    .getByRole('listitem')
    .elements()
    .map((element) => element.textContent.split(':')[0]);

const SUCCESS_MESSAGES = [
  'コメントしました。',
  'コメントと評価を投稿しました。',
  '返信しました。',
  'コメントを更新しました。',
  'コメントを削除しました。',
];

beforeEach(() => {
  executeGraphQL.mockReset();
  countResponses = [2, 3];
});

afterEach(() => {
  toast.dismiss();
});

describe('useCommentMutations', () => {
  test('スレッドのページは最初にカーソル無しで読み、続きは前のページの最後のカーソルで読み足す', async () => {
    await renderHarness(new Map());

    await press('続きを読む');

    await expect.element(item(OLDER_ID)).toBeInTheDocument();
    expect(
      callsOf(ClientLaunchCommentsDocument).map(({ variables }) => variables),
    ).toStrictEqual([
      { productId: PRODUCT_ID, launchId: LAUNCH_ID },
      { productId: PRODUCT_ID, launchId: LAUNCH_ID, after: 'cursor-1' },
    ]);
    expect(
      callsOf(ClientLaunchCommentCountsDocument).map(
        ({ variables }) => variables,
      ),
    ).toStrictEqual([{ productId: PRODUCT_ID }]);
  });

  test('投稿の成功で、最初のページの先頭に加え、件数を取り直し「コメントしました。」を通知する', async () => {
    const posted = commentOf(NEW_ID, { body: '新しい本文' });
    await renderHarness(
      new Map([
        [
          ClientPostCommentDocument,
          () => ({ postComment: { comment: posted, rating: null } }),
        ],
      ]),
    );

    await press('投稿');

    await expect.element(toastText('コメントしました。')).toBeVisible();
    await expect.element(count()).toHaveTextContent('3');
    expect(listedIds()).toStrictEqual([NEW_ID, ROOT_ID, REPLY_ID]);
    expect(callsOf(ClientPostCommentDocument)).toStrictEqual([
      {
        variables: {
          input: {
            productId: PRODUCT_ID,
            launchId: LAUNCH_ID,
            body: '新しい本文',
          },
        },
        options: { turnstileToken: TOKEN },
      },
    ]);
    expect(callsOf(ClientLaunchCommentCountsDocument)).toHaveLength(2);
  });

  test('評価を添えた投稿の成功で、評価を送り、評価欄の値を結果で置き換えて「コメントと評価を投稿しました。」を通知する', async () => {
    const posted = commentOf(NEW_ID, { body: '新しい本文' });
    const queryClient = await renderHarness(
      new Map([
        [
          ClientPostCommentDocument,
          () => ({ postComment: { comment: posted, rating: RATED } }),
        ],
      ]),
    );

    await press('評価を添えて投稿');

    await expect
      .element(toastText('コメントと評価を投稿しました。'))
      .toBeVisible();
    expect(listedIds()[0]).toBe(NEW_ID);
    expect(queryClient.getQueryData(ratingKey())).toStrictEqual({
      productRating: RATED,
    });
    expect(
      callsOf(ClientPostCommentDocument)[0]?.variables['input'],
    ).toStrictEqual({
      productId: PRODUCT_ID,
      launchId: LAUNCH_ID,
      body: '新しい本文',
      rating: 5,
    });
    await expect.element(count()).toHaveTextContent('3');
  });

  test('返信の成功で、親を含むスレッドの末尾に加え、件数を取り直し「返信しました。」を通知する', async () => {
    const replied = commentOf(NEW_ID, {
      parentId: REPLY_ID,
      depth: 3,
      body: '新しい本文',
    });
    await renderHarness(
      new Map([
        [
          ClientPostCommentDocument,
          () => ({ postComment: { comment: replied, rating: null } }),
        ],
      ]),
    );

    await press('返信');

    await expect.element(toastText('返信しました。')).toBeVisible();
    await expect.element(count()).toHaveTextContent('3');
    expect(listedIds()).toStrictEqual([ROOT_ID, REPLY_ID, NEW_ID]);
    expect(callsOf(ClientPostCommentDocument)).toStrictEqual([
      {
        variables: {
          input: {
            productId: PRODUCT_ID,
            launchId: LAUNCH_ID,
            parentId: REPLY_ID,
            body: '新しい本文',
          },
        },
        options: { turnstileToken: TOKEN },
      },
    ]);
  });

  test('編集の成功で、該当の項目を結果で置き換え「コメントを更新しました。」を通知し、件数を取り直さない', async () => {
    const updated = { ...ROOT, body: '新しい本文', edited: true };
    const queryClient = await renderHarness(
      new Map([
        [
          ClientUpdateCommentDocument,
          () => ({ updateComment: { comment: updated, rating: null } }),
        ],
      ]),
    );

    await press('編集');

    await expect.element(toastText('コメントを更新しました。')).toBeVisible();
    await expect.element(item(ROOT_ID)).toHaveTextContent('新しい本文');
    expect(callsOf(ClientUpdateCommentDocument)).toStrictEqual([
      {
        variables: { input: { commentId: ROOT_ID, body: '新しい本文' } },
        options: { turnstileToken: TOKEN },
      },
    ]);
    expect(callsOf(ClientLaunchCommentCountsDocument)).toHaveLength(1);
    expect(queryClient.getQueryData(ratingKey())).toStrictEqual({
      productRating: ratingOf(),
    });
  });

  test('評価を添えた編集の成功で、評価を送り、評価欄の値を結果で置き換えて「コメントを更新しました。」を通知する', async () => {
    const updated = { ...ROOT, body: '新しい本文', edited: true };
    const queryClient = await renderHarness(
      new Map([
        [
          ClientUpdateCommentDocument,
          () => ({ updateComment: { comment: updated, rating: RATED } }),
        ],
      ]),
    );

    await press('評価を添えて編集');

    await expect.element(toastText('コメントを更新しました。')).toBeVisible();
    expect(
      callsOf(ClientUpdateCommentDocument)[0]?.variables['input'],
    ).toStrictEqual({ commentId: ROOT_ID, body: '新しい本文', rating: 5 });
    expect(queryClient.getQueryData(ratingKey())).toStrictEqual({
      productRating: RATED,
    });
  });

  test('削除の成功で、該当の項目を置き換え表示にして返信の木を保ち、件数を取り直し「コメントを削除しました。」を通知する', async () => {
    countResponses = [2, 1];
    const removed = commentOf(REPLY_ID, {
      parentId: ROOT_ID,
      depth: 2,
      state: 'REMOVED',
      author: null,
      body: null,
      createdAt: null,
      viewerIsAuthor: false,
    });
    await renderHarness(
      new Map([
        [ClientDeleteCommentDocument, () => ({ deleteComment: removed })],
      ]),
    );

    await press('削除');

    await expect.element(toastText('コメントを削除しました。')).toBeVisible();
    await expect.element(item(REPLY_ID)).toHaveTextContent('削除済み');
    await expect.element(count()).toHaveTextContent('1');
    expect(listedIds()).toStrictEqual([ROOT_ID, REPLY_ID]);
    expect(callsOf(ClientDeleteCommentDocument)).toStrictEqual([
      {
        variables: { commentId: REPLY_ID },
        options: { turnstileToken: TOKEN },
      },
    ]);
  });

  test.each<[string, string, unknown, GraphQLClientError]>([
    ['投稿', '投稿', ClientPostCommentDocument, INTERNAL_ERROR],
    [
      '評価を添えた投稿',
      '評価を添えて投稿',
      ClientPostCommentDocument,
      INTERNAL_ERROR,
    ],
    ['返信', '返信', ClientPostCommentDocument, PARENT_UNAVAILABLE],
    ['編集', '評価を添えて編集', ClientUpdateCommentDocument, INTERNAL_ERROR],
    ['削除', '削除', ClientDeleteCommentDocument, INTERNAL_ERROR],
  ])(
    '%sの失敗で、スレッドのページ・件数・評価欄の値を変えず、通知せずに失敗を呼び出し元へ渡して理由の文言を出させる',
    async (_label, button, document, error) => {
      const queryClient = await renderHarness(
        new Map([[document, () => error]]),
      );
      const threadsBefore = queryClient.getQueryData(threadsKey());

      await press(button);

      await expect
        .element(page.getByRole('alert'))
        .toHaveTextContent(error.message);
      expect(queryClient.getQueryData(threadsKey())).toBe(threadsBefore);
      expect(queryClient.getQueryData(ratingKey())).toStrictEqual({
        productRating: ratingOf(),
      });
      expect(callsOf(ClientLaunchCommentCountsDocument)).toHaveLength(1);
      await expect.element(count()).toHaveTextContent('2');
      for (const message of SUCCESS_MESSAGES) {
        expect(
          page.getByText(message, { exact: true }).elements(),
        ).toHaveLength(0);
      }
      expect(callsOf(document)).toHaveLength(1);
    },
  );
});
