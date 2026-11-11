import { createRoute } from '@tanstack/react-router';
import type { Mock } from 'vitest';

import { HELP_CATEGORY_OTHER_ID } from '../common-lib/help/help-category-constants.ts';
import { parseHelpArticleFilter } from '../src/components/help/help-article-filter.ts';
import { loadAdminHelpArticlesPage } from '../src/graphql/admin-help-articles.ts';
import {
  AdminHelpArticlesDocument,
  type AdminHelpArticlesQuery,
  AdminHelpCategoriesDocument,
  type AdminHelpCategoriesQuery,
  type AdminRole,
} from '../src/graphql/generated/graphql.ts';
import { Route as AuthenticatedRoute } from '../src/routes/_authenticated/route.tsx';
import { Route as HelpArticlesRoute } from '../src/routes/_authenticated/help-articles/index.tsx';
import {
  type GraphQLHandler,
  respondAdminGraphQL,
  success,
} from './admin-accounts-fixtures.ts';
import { adminWithRole } from './admin-viewer-fixtures.ts';
import { type PageRootRoute, renderPageRouter } from './page-router.tsx';

export const HELP_ARTICLES_PATH = '/help-articles';

export type AdminHelpArticleRowFields =
  AdminHelpArticlesQuery['adminHelpArticles'][number];

export type AdminHelpCategoryFields =
  AdminHelpCategoriesQuery['adminHelpCategories'][number];

export const PRICING_CATEGORY: AdminHelpCategoryFields = Object.freeze({
  id: '01JD0HCAT00000000000000002',
  name: '料金',
  systemDefault: false,
  sortOrder: 1,
  articleCount: 1,
});

export const USAGE_CATEGORY: AdminHelpCategoryFields = Object.freeze({
  id: '01JD0HCAT00000000000000001',
  name: '使い方',
  systemDefault: false,
  sortOrder: 2,
  articleCount: 2,
});

export const OTHER_CATEGORY: AdminHelpCategoryFields = Object.freeze({
  id: HELP_CATEGORY_OTHER_ID,
  name: 'その他',
  systemDefault: true,
  sortOrder: 3,
  articleCount: 1,
});

// 名前の順やIDの順と異なる、管理者が指定した並び順
export const HELP_CATEGORIES: AdminHelpCategoriesQuery = {
  adminHelpCategories: [
    { ...PRICING_CATEGORY },
    { ...USAGE_CATEGORY },
    { ...OTHER_CATEGORY },
  ],
};

export const SUPPORT_AUTHOR_ID = '01JD0ADMIN0000000000000001';

export const EDITOR_AUTHOR_ID = '01JD0ADMIN0000000000000002';

export const DELETED_AUTHOR_ID = '01JD0ADMIN0000000000000003';

export const OTHER_DELETED_AUTHOR_ID = '01JD0ADMIN0000000000000004';

export const SUPPORT_AUTHOR = Object.freeze({
  nickname: '山田サポート',
  title: 'サポート',
  avatar: {
    id: '01JD0MEDIA0000000000000001',
    objectKey: 'fedcba9876543210'.repeat(2),
    fallbackFormat: 'PNG',
    width: 256,
    height: 256,
  },
} as const);

export const EDITOR_AUTHOR = Object.freeze({
  nickname: '伊藤編集',
  title: null,
  avatar: null,
});

// 更新日時の新しい順(APIが返す順)
export const PUBLISHED_ARTICLE: AdminHelpArticleRowFields = Object.freeze({
  id: '01JD0HART00000000000000001',
  handle: 'how-upvote-works',
  title: 'Upvoteの仕組み',
  categoryId: USAGE_CATEGORY.id,
  categoryName: USAGE_CATEGORY.name,
  status: 'PUBLISHED',
  pinned: true,
  sortOrder: 1,
  creatorAdminId: SUPPORT_AUTHOR_ID,
  creator: SUPPORT_AUTHOR,
  createdAt: '2026-11-01T01:00:00.000Z',
  updatedAt: '2026-11-10T05:30:00.000Z',
});

export const DRAFT_ARTICLE: AdminHelpArticleRowFields = Object.freeze({
  id: '01JD0HART00000000000000002',
  handle: 'Pricing-Plans',
  title: '料金プランの違い',
  categoryId: PRICING_CATEGORY.id,
  categoryName: PRICING_CATEGORY.name,
  status: 'DRAFT',
  pinned: false,
  sortOrder: 1,
  creatorAdminId: EDITOR_AUTHOR_ID,
  creator: EDITOR_AUTHOR,
  createdAt: '2026-11-02T01:00:00.000Z',
  updatedAt: '2026-11-09T03:00:00.000Z',
});

export const DELETED_AUTHOR_ARTICLE: AdminHelpArticleRowFields = Object.freeze({
  id: '01JD0HART00000000000000003',
  handle: 'account-deletion',
  title: 'アカウントの削除',
  categoryId: USAGE_CATEGORY.id,
  categoryName: USAGE_CATEGORY.name,
  status: 'DRAFT',
  pinned: false,
  sortOrder: 2,
  creatorAdminId: DELETED_AUTHOR_ID,
  creator: null,
  createdAt: '2026-11-03T01:00:00.000Z',
  updatedAt: '2026-11-08T00:00:00.000Z',
});

export const OTHER_DELETED_AUTHOR_ARTICLE: AdminHelpArticleRowFields =
  Object.freeze({
    id: '01JD0HART00000000000000004',
    handle: 'contact',
    title: '問い合わせの方法',
    categoryId: OTHER_CATEGORY.id,
    categoryName: OTHER_CATEGORY.name,
    status: 'PUBLISHED',
    pinned: false,
    sortOrder: 1,
    creatorAdminId: OTHER_DELETED_AUTHOR_ID,
    creator: null,
    createdAt: '2026-11-04T01:00:00.000Z',
    updatedAt: '2026-11-07T00:00:00.000Z',
  });

export const helpArticlesQueryOf = (
  rows: readonly AdminHelpArticleRowFields[],
): AdminHelpArticlesQuery => ({
  adminHelpArticles: rows.map((row) => ({ ...row })),
});

export const ALL_ARTICLES = helpArticlesQueryOf([
  PUBLISHED_ARTICLE,
  DRAFT_ARTICLE,
  DELETED_AUTHOR_ARTICLE,
  OTHER_DELETED_AUTHOR_ARTICLE,
]);

// 記事の全件・カテゴリの一覧・ログイン中の管理者の取得に応答し、記事とカテゴリはテストが渡した応答にする
export function respondAdminHelpArticlesGraphQL(
  executeGraphQL: Mock,
  {
    role,
    articles = () => success(ALL_ARTICLES),
    categories = () => success(HELP_CATEGORIES),
  }: {
    readonly role: AdminRole;
    readonly articles?: GraphQLHandler;
    readonly categories?: GraphQLHandler;
  },
): void {
  respondAdminGraphQL(executeGraphQL, {
    role,
    handlers: new Map<unknown, GraphQLHandler>([
      [AdminHelpArticlesDocument, articles],
      [AdminHelpCategoriesDocument, categories],
    ]),
  });
}

// アプリの経路の設定を、画面のテスト用のルーターの同じ位置(同じ経路のID)の経路へ写す。経路の設定の検索パラメータの検証とloaderは型がアプリの経路の木に結び付き写せないため、同じ関数を渡す(同じ関数であることは画面のテストが確かめる)
const createRoutes = (rootRoute: PageRootRoute) => {
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_authenticated',
    beforeLoad: AuthenticatedRoute.options.beforeLoad,
    component: AuthenticatedRoute.options.component,
  });
  const helpArticlesRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: 'help-articles',
  });
  return [
    authenticatedRoute.addChildren([
      helpArticlesRoute.addChildren([
        createRoute({
          getParentRoute: () => helpArticlesRoute,
          path: '/',
          validateSearch: parseHelpArticleFilter,
          loader: loadAdminHelpArticlesPage,
          component: HelpArticlesRoute.options.component,
        }),
      ]),
    ]),
  ];
};

export const renderHelpArticlesPage = (
  role: AdminRole,
  path: string = HELP_ARTICLES_PATH,
) =>
  renderPageRouter({ path, createRoutes, cachedViewer: adminWithRole(role) });
