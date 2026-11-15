import { createRoute, useSearch } from '@tanstack/react-router';
import { expect, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { normalizeDirectoryQuery } from '../../../common-lib/directory/directory-query-rules.ts';
import { executeGraphQL } from '../../../lib/start/graphql/execute-graphql.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { renderPageRouter } from '../../../test/page-router.tsx';
import {
  ClientDirectoryCategoriesDocument,
  type ClientDirectoryCategoriesQuery,
  ClientDirectoryDocument,
  type ClientDirectoryQuery,
  type ClientDirectoryQueryVariables,
} from '../../graphql/generated/graphql.ts';
import { useViewer } from '../auth/use-viewer.ts';
import { directoryItemOf } from './directory-item-fixtures.ts';
import type { DirectoryItemData } from './directory-item-types.ts';
import { DirectoryPage } from './directory-page.tsx';
import type {
  DirectoryItemMetric,
  DirectoryListInsert,
  DirectorySection,
} from './directory-section-types.ts';

export const DESKTOP = { width: 1280, height: 900 } as const;

export const LIST_ERROR_MESSAGE =
  'プロダクト一覧を読み込めませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。';

export const UNEXPECTED_MESSAGE =
  'ページを表示できませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。';

export const DESCRIPTION =
  '予選マッチに勝利したプロダクトだけが並ぶカタログです。';

export const LAUNCH_CTA_TITLE = 'あなたのプロダクトもここに並べましょう。';

type Directory = ClientDirectoryQuery['directory'];

export const itemsFrom = (start: number, count: number): DirectoryItemData[] =>
  Array.from({ length: count }, (_, index) => {
    const number = start + index;
    return directoryItemOf({
      handle: `product-${String(number)}`,
      name: `プロダクト${String(number)}`,
    });
  });

export const directoryOf = (overrides: Partial<Directory> = {}): Directory => {
  const items = overrides.items ?? itemsFrom(1, 3);
  return {
    applied: {
      q: null,
      category: null,
      from: null,
      to: null,
      sort: null,
      page: null,
    },
    businessToday: '2026-11-10',
    page: 1,
    pageCount: 1,
    totalCount: items.length,
    searchTerms: [],
    ...overrides,
    items,
  };
};

const CATEGORIES: ClientDirectoryCategoriesQuery = {
  directoryCategories: [
    {
      id: '01JCATEGORY0000000000000001',
      name: '開発ツール',
      handle: 'developer-tools',
    },
  ],
};

export const CATEGORIES_RESULT = Object.freeze({
  ok: true,
  data: CATEGORIES,
});

export const okDirectory = (directory: Directory) => ({
  ok: true,
  data: { directory } satisfies ClientDirectoryQuery,
});

export const FAILURE = {
  ok: false,
  error: new GraphQLClientError({
    code: 'internal_error',
    message: 'サーバーでエラーが発生しました。',
    status: 500,
  }),
} as const;

type DirectoryResponder = (variables: ClientDirectoryQueryVariables) => unknown;

// テストのファイルがexecuteGraphQLをvi.mockで偽にしてから使う
export const respond = (
  directory: DirectoryResponder,
  categories: () => unknown = () => CATEGORIES_RESULT,
): void => {
  vi.mocked(executeGraphQL).mockImplementation(((
    document: unknown,
    variables: ClientDirectoryQueryVariables,
  ) => {
    if (document === ClientDirectoryDocument) {
      return Promise.resolve(directory(variables));
    }
    if (document === ClientDirectoryCategoriesDocument) {
      return Promise.resolve(categories());
    }
    throw new Error('想定していない操作が実行されました。');
  }) as never);
};

export const deferred = <T,>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

export const lastDirectoryInput = () =>
  (
    vi
      .mocked(executeGraphQL)
      .mock.calls.filter(([document]) => document === ClientDirectoryDocument)
      .at(-1)?.[1] as ClientDirectoryQueryVariables | undefined
  )?.input;

export interface RenderDirectoryOptions {
  readonly path?: string;
  readonly sections?: readonly DirectorySection[];
  readonly inserts?: readonly DirectoryListInsert[];
  readonly metrics?: readonly DirectoryItemMetric[];
}

// /pのルートは別に作るため、同じ正規化で検索パラメータを読むテスト用の経路で画面の枠を描く
export const renderDirectory = ({
  path = '/p',
  sections = [],
  inserts = [],
  metrics = [],
}: RenderDirectoryOptions = {}) =>
  renderPageRouter({
    path,
    createRoutes: (rootRoute) => [
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/p',
        validateSearch: normalizeDirectoryQuery,
        component: function TestDirectoryRoute() {
          const search = useSearch({ strict: false });
          const viewer = useViewer();
          return (
            <DirectoryPage
              query={normalizeDirectoryQuery(search)}
              viewer={viewer}
              sections={sections}
              inserts={inserts}
              metrics={metrics}
            />
          );
        },
      }),
    ],
  });

export const mainContent = (): HTMLElement => {
  const main = document.querySelector('main');
  if (main === null) {
    throw new Error('本文の領域がありません。');
  }
  return main;
};

export const pageHeading = () =>
  page.getByRole('heading', { level: 1, name: 'ディレクトリ' });
export const listHeading = () =>
  page.getByRole('heading', { level: 2, name: 'プロダクト一覧' });
export const listRegion = () =>
  page.getByRole('region', { name: 'プロダクト一覧' });
export const articles = () => page.getByRole('article');
export const articleOf = (name: string) =>
  page.getByRole('article', { name, exact: true });
export const searchBox = () =>
  page.getByRole('searchbox', { name: '検索キーワード' });
export const searchButton = () =>
  page.getByRole('button', { name: '検索', exact: true });
export const categoryTrigger = () =>
  page.getByRole('button', { name: /^カテゴリ / });
export const sortTrigger = () => page.getByRole('button', { name: /^並び順 / });
export const pagination = () =>
  page.getByRole('navigation', { name: 'プロダクト一覧のページ送り' });
export const launchCtaHeading = () =>
  page.getByRole('heading', { name: LAUNCH_CTA_TITLE });
export const textOf = (text: string) => page.getByText(text, { exact: true });

export const follows = (earlier: Element, later: Element): boolean =>
  (earlier.compareDocumentPosition(later) &
    Node.DOCUMENT_POSITION_FOLLOWING) !==
  0;

export const expectInOrder = (elements: readonly Element[]): boolean =>
  elements
    .slice(1)
    .every((element, index) => follows(elements[index] as Element, element));

export const progressBar = (): Element | null =>
  document.querySelector('[data-directory-progress]');

export const chooseSort = async (name: string): Promise<void> => {
  await userEvent.click(sortTrigger());
  await userEvent.click(page.getByRole('menuitemradio', { name, exact: true }));
  // メニューの閉じる動きと外側の要素の隠し方の解除を待ってから、表示の検査をする
  await expect.element(page.getByRole('menu')).not.toBeInTheDocument();
  await expect
    .poll(() =>
      document
        .getAnimations()
        .filter(
          (animation) =>
            !(
              animation.effect instanceof KeyframeEffect &&
              animation.effect.target instanceof Element &&
              progressBar()?.contains(animation.effect.target) === true
            ),
        ),
    )
    .toHaveLength(0);
};
