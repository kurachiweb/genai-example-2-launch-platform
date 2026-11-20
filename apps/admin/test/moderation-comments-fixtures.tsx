import { createRoute } from '@tanstack/react-router';
import type { Mock } from 'vitest';
import { render } from 'vitest-browser-react';

import { Toaster } from '../lib/components/feedback/toaster.tsx';
import { loadCommentsPage } from '../src/components/moderation/comments/load-comments-page.ts';
import {
  AdminCommentsDocument,
  type AdminCommentsQuery,
  type AdminCommentsQueryVariables,
  type AdminRole,
} from '../src/graphql/generated/graphql.ts';
import { Route as AuthenticatedRoute } from '../src/routes/_authenticated/route.tsx';
import { Route as CommentsRoute } from '../src/routes/_authenticated/comments/index.tsx';
import { success } from './admin-accounts-fixtures.ts';
import { adminWithRole } from './admin-viewer-fixtures.ts';
import {
  MODERATION_REASON,
  type ModerationGraphQLHandler,
  respondModerationGraphQL,
} from './moderation-fixtures.ts';
import { type PageRootRoute, renderPageRouter } from './page-router.tsx';

export const COMMENTS_PATH = '/comments';

export type CommentNode = AdminCommentsQuery['adminComments']['nodes'][number];

const PRODUCT_ID = '01KA0PR0DVCT00000000000001';

const LAUNCH_ID = '01KA0LAVNCH000000000000001';

// マークダウンとして描画すると強調とリンクになる本文の先頭
export const MARKDOWN_EXCERPT =
  '**とても良い**プロダクトです。[詳しくはこちら](https://site.example)\n<script>alert(1)</script>';

export const SHOWN_COMMENT_NODE: CommentNode = Object.freeze<CommentNode>({
  id: '01KA0C0MMENT00000000000001',
  excerpt: MARKDOWN_EXCERPT,
  author: {
    id: '01KA0VSER00000000000000001',
    handle: 'maker_ai',
    nickname: 'サンプル太郎',
    suspended: false,
  },
  productName: 'Pitch Notes',
  productId: PRODUCT_ID,
  launchId: LAUNCH_ID,
  launchNumber: 3,
  createdAt: '2026-11-10T01:00:00.000Z',
  state: 'SHOWN',
  latestHide: null,
});

export const HIDDEN_COMMENT_NODE: CommentNode = Object.freeze<CommentNode>({
  id: '01KA0C0MMENT00000000000002',
  excerpt: '宣伝のリンクだけのコメント',
  author: {
    id: '01KA0VSER00000000000000002',
    handle: 'pixel_hanako',
    nickname: 'サンプル花子',
    suspended: false,
  },
  productName: 'Pitch Notes',
  productId: PRODUCT_ID,
  launchId: LAUNCH_ID,
  launchNumber: 1,
  createdAt: '2026-11-09T03:30:00.000Z',
  state: 'HIDDEN',
  latestHide: {
    reason: MODERATION_REASON,
    occurredAt: '2026-11-12T03:00:00.000Z',
  },
});

// 取り消したローンチのブロックに付いたコメント
export const DELETED_COMMENT_NODE: CommentNode = Object.freeze<CommentNode>({
  id: '01KA0C0MMENT00000000000003',
  excerpt: '投稿者が削除したコメント',
  author: {
    id: '01KA0VSER00000000000000003',
    handle: 'spam_jiro',
    nickname: 'サンプル次郎',
    suspended: false,
  },
  productName: 'Pitch Notes',
  productId: PRODUCT_ID,
  launchId: LAUNCH_ID,
  launchNumber: 0,
  createdAt: '2026-11-08T00:00:00.000Z',
  state: 'DELETED',
  latestHide: null,
});

// 投稿者を読めず、プロダクトが論理削除され、ローンチを読めないコメント
export const ANONYMIZED_COMMENT_NODE: CommentNode = Object.freeze<CommentNode>({
  id: '01KA0C0MMENT00000000000004',
  excerpt: '',
  author: null,
  productName: null,
  productId: '01KA0PR0DVCT00000000000002',
  launchId: '01KA0LAVNCH000000000000002',
  launchNumber: null,
  createdAt: '2026-11-07T00:00:00.000Z',
  state: 'ANONYMIZED',
  latestHide: null,
});

export const UNAVAILABLE_AUTHOR_COMMENT_NODE: CommentNode =
  Object.freeze<CommentNode>({
    id: '01KA0C0MMENT00000000000005',
    excerpt: '停止中の投稿者のコメント',
    author: {
      id: '01KA0VSER00000000000000004',
      handle: 'old_saburo',
      nickname: 'サンプル三郎',
      suspended: true,
    },
    productName: 'Pitch Notes',
    productId: PRODUCT_ID,
    launchId: LAUNCH_ID,
    launchNumber: 2,
    createdAt: '2026-11-06T00:00:00.000Z',
    state: 'AUTHOR_UNAVAILABLE',
    latestHide: null,
  });

export const COMMENT_NODES: readonly CommentNode[] = Object.freeze([
  SHOWN_COMMENT_NODE,
  HIDDEN_COMMENT_NODE,
  DELETED_COMMENT_NODE,
  ANONYMIZED_COMMENT_NODE,
  UNAVAILABLE_AUTHOR_COMMENT_NODE,
]);

export const commentsQueryOf = (
  nodes: readonly CommentNode[],
  endCursor: string | null = null,
): AdminCommentsQuery => ({
  adminComments: {
    nodes: [...nodes],
    pageInfo: { hasNextPage: endCursor !== null, endCursor },
  },
});

export type CommentsHandler = (
  variables: AdminCommentsQueryVariables,
) => Promise<unknown>;

// ログイン中の管理者と、コメントの一覧・措置の操作にテストが渡した応答を返す
export function respondCommentsGraphQL(
  executeGraphQL: Mock,
  {
    role,
    comments = () => success(commentsQueryOf(COMMENT_NODES)),
    handlers = new Map(),
  }: {
    readonly role: AdminRole;
    readonly comments?: CommentsHandler;
    readonly handlers?: ReadonlyMap<unknown, ModerationGraphQLHandler>;
  },
): void {
  respondModerationGraphQL(executeGraphQL, {
    role,
    handlers: new Map<unknown, ModerationGraphQLHandler>([
      [
        AdminCommentsDocument,
        (variables) => comments(variables as AdminCommentsQueryVariables),
      ],
      ...handlers,
    ]),
  });
}

// アプリの経路の設定を、画面のテスト用のルーターの同じ位置(同じ経路のID)の経路へ写す。検索パラメータの検証・loaderの依存・loaderは型がアプリの経路の木に結び付き写せないため、同じ関数を渡す(同じ関数であることは画面のテストが確かめる)
const createRoutes = (rootRoute: PageRootRoute) => {
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_authenticated',
    beforeLoad: AuthenticatedRoute.options.beforeLoad,
    component: AuthenticatedRoute.options.component,
  });
  const commentsRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: 'comments',
  });
  return [
    authenticatedRoute.addChildren([
      commentsRoute.addChildren([
        createRoute({
          getParentRoute: () => commentsRoute,
          path: '/',
          validateSearch: CommentsRoute.options.validateSearch,
          loaderDeps: ({ search }) => search,
          loader: loadCommentsPage,
          component: CommentsRoute.options.component,
        }),
      ]),
    ]),
  ];
};

// 措置の結果のトーストは文書の外枠が置くため、ページのルーターの外に置く
export async function renderCommentsPage(
  role: AdminRole,
  path = COMMENTS_PATH,
) {
  await render(<Toaster />);
  return renderPageRouter({
    path,
    createRoutes,
    cachedViewer: adminWithRole(role),
  });
}

export const commentsVariablesOf = (
  executeGraphQL: Mock,
): readonly AdminCommentsQueryVariables[] =>
  executeGraphQL.mock.calls
    .filter(([document]) => document === AdminCommentsDocument)
    .map(([, variables]) => variables as AdminCommentsQueryVariables);
