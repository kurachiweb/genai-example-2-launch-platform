import { expect, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { Toaster } from '../../../lib/components/feedback/toaster.tsx';
import { TooltipProvider } from '../../../lib/components/ui/tooltip/tooltip-provider.tsx';
import { executeGraphQL } from '../../../lib/start/graphql/execute-graphql.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import {
  createPageRouterContext,
  renderInRouter,
} from '../../../test/page-router.tsx';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import {
  ClientLaunchCommentCountsDocument,
  ClientLaunchCommentsDocument,
  type ClientLaunchCommentsQuery,
  ClientProductRatingDocument,
  ClientViewerDocument,
  type ClientViewerQuery,
  type LaunchCommentFragment,
} from '../../graphql/generated/graphql.ts';
import { CommentThread } from './comment-thread.tsx';

// 呼び出す側のテストのファイルがvi.mockで模擬に替えた取得の関数を操る
const mockedExecuteGraphQL = vi.mocked(executeGraphQL);

export const PRODUCT = Object.freeze({
  id: '01JC0PRODUCT00000000000000',
  handle: 'pitch_notes',
});

export const LAUNCH = Object.freeze({ id: '01JC0LAUNCH000000000000000' });

export const OUTSIDE = 'コメント欄の外';

export const UNVERIFIED = signedInViewerQuery({ emailVerified: false });

export const POST_PLACEHOLDER =
  'このローンチへのコメントを書く(マークダウン対応)';

export const LOAD_ERROR = 'コメントを読み込めませんでした。';

export const INTERNAL_ERROR = new GraphQLClientError({
  code: 'internal_error',
  message: 'サーバーでエラーが発生しました。',
  status: 500,
});

const NOW = Date.now();

export const idOf = (index: number) =>
  `01JC0COMMENT${String(index).padStart(14, '0')}`;

export const commentOf = (
  index: number,
  overrides: Partial<LaunchCommentFragment> = {},
): LaunchCommentFragment => ({
  id: idOf(index),
  parentId: null,
  depth: 1,
  state: 'SHOWN',
  author: {
    handle: `fan_${String(index)}`,
    nickname: `ファン${String(index)}`,
    avatar: null,
  },
  body: `本文${String(index)}`,
  createdAt: new Date(NOW - index * 60 * 60 * 1000).toISOString(),
  edited: false,
  byProductOwner: false,
  viewerIsAuthor: false,
  ...overrides,
});

type Thread = NonNullable<
  ClientLaunchCommentsQuery['launchComments']
>['nodes'][number];

export const threadOf = (
  comment: LaunchCommentFragment,
  replies: readonly LaunchCommentFragment[] = [],
): Thread => ({ comment, replies: [...replies] });

// nextを渡すと、そのカーソルで続きがあるページにする
export const pageOf = (
  nodes: readonly Thread[],
  next: string | null = null,
): ClientLaunchCommentsQuery => ({
  launchComments: {
    nodes: [...nodes],
    pageInfo: { endCursor: next ?? 'last', hasNextPage: next !== null },
  },
});

export const threadsFrom = (from: number, count: number): Thread[] =>
  Array.from({ length: count }, (_, offset) =>
    threadOf(commentOf(from + offset)),
  );

type Result = { readonly ok: true; readonly data: unknown } | Error;

export type Responder = (
  variables: Record<string, unknown>,
) => Result | Promise<Result>;

export const ok = (data: unknown): Result => ({ ok: true, data });

export interface ThreadResponses {
  readonly pages?: Responder;
  readonly mutations?: ReadonlyMap<unknown, Responder>;
  readonly viewer?: ClientViewerQuery;
}

const RATING = Object.freeze({
  productRating: {
    productId: PRODUCT.id,
    average: 4,
    count: 3,
    viewerScore: null,
  },
});

const respondWith = ({
  pages = () => ok(pageOf([])),
  mutations = new Map(),
  viewer = signedInViewerQuery(),
}: ThreadResponses) => {
  const queries = new Map<unknown, Responder>([
    [ClientLaunchCommentsDocument, pages],
    [ClientLaunchCommentCountsDocument, () => ok({ launchCommentCounts: [] })],
    [ClientProductRatingDocument, () => ok(RATING)],
    [ClientViewerDocument, () => ok(viewer)],
  ]);
  mockedExecuteGraphQL.mockImplementation(async (document, variables) => {
    const respond = queries.get(document) ?? mutations.get(document);
    if (respond === undefined) {
      throw new Error('想定していない操作が実行されました。');
    }
    const result = await respond(variables as Record<string, unknown>);
    return (
      result instanceof Error ? { ok: false, error: result } : result
    ) as never;
  });
};

export const callsOf = (document: unknown) =>
  mockedExecuteGraphQL.mock.calls
    .filter(([called]) => called === document)
    .map(([, variables]) => variables as Record<string, unknown>);

export interface RenderThreadOptions extends ThreadResponses {
  readonly viewerIsOwner?: boolean;
}

// アプリの文書の外枠と同じく、日時の部品に表示設定を、投稿日時と「返信」のツールチップに共通の設定を渡す
export const renderThread = async ({
  viewerIsOwner = false,
  ...responses
}: RenderThreadOptions = {}): Promise<void> => {
  const viewer = responses.viewer ?? signedInViewerQuery();
  respondWith({ ...responses, viewer });
  await renderInRouter(
    <DisplayPreferencesProvider
      initial={{ timeZone: 'Asia/Tokyo', locale: 'ja-JP' }}
    >
      <TooltipProvider>
        <main className="flex flex-col gap-4 bg-background p-4 text-foreground">
          <p>{OUTSIDE}</p>
          <CommentThread
            product={PRODUCT}
            launch={LAUNCH}
            viewerIsOwner={viewerIsOwner}
          />
        </main>
        <Toaster />
      </TooltipProvider>
    </DisplayPreferencesProvider>,
    { context: createPageRouterContext('local'), cachedViewer: viewer },
  );
  await userEvent.hover(page.getByText(OUTSIDE));
};

export const articleOf = (nickname: string) =>
  page.getByRole('article', { name: `${nickname}さんのコメント` });

export const topLevelArticles = () =>
  [
    ...document.querySelectorAll<HTMLElement>(
      '[data-slot="comment-list"] > li > article',
    ),
  ].map((element) => element.getAttribute('aria-label'));

export const threadRoot = () => {
  const root = document.querySelector<HTMLElement>(
    '[data-slot="comment-thread"]',
  );
  if (root === null) {
    throw new Error('コメント欄がありません。');
  }
  return page.elementLocator(root);
};

export const editorOf = (name: string) => page.getByRole('textbox', { name });

export const button = (name: string) =>
  page.getByRole('button', { name, exact: true });

export async function typeInto(name: string, text: string): Promise<void> {
  await expect.element(editorOf(name)).toBeInTheDocument();
  await expect
    .element(page.getByRole('button', { name: '太字', exact: true }).first())
    .not.toHaveAttribute('disabled');
  await userEvent.click(editorOf(name));
  await userEvent.keyboard(text);
}

// 判定の偽物は描いた順に並ぶため、最後に開いた投稿欄の判定を成功させる
export const passBotCheck = () =>
  userEvent.click(button('判定を成功させる').last());

// モーダルのダイアログの間は外側の要素が支援技術とポインターから隠れるため、ダイアログの外に描く判定の偽物のボタンは要素を直接押す
// 判定の偽物は描いた順に並ぶため、最後に開いた投稿欄の判定を成功させる
export const passBotCheckBehindDialog = () => {
  const target = page.getByText('判定を成功させる').last().element();
  if (!(target instanceof HTMLButtonElement)) {
    throw new Error('判定の偽物のボタンがありません。');
  }
  target.click();
};

// 取得を手元で解決するまで待たせる
export function deferred(): {
  readonly gate: Promise<void>;
  readonly release: () => void;
} {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { gate, release };
}
