import { createRoute } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../src/styles.css';
import { runAxe } from '../lib/test/a11y.ts';
import { emulateBrowserDisplay } from '../lib/test/display-emulation.ts';
import { GraphQLClientError } from '../lib/utilities/graphql/graphql-result.ts';
import {
  ClientHelpArticleDocument,
  type ClientHelpArticleQuery,
} from '../src/graphql/generated/graphql.ts';
import {
  type HelpArticleLoaderData,
  type HelpArticleView,
  helpArticleQueryOptions,
} from '../src/graphql/help-center.ts';
import type { buildSitePageHead } from '../src/head/page-heads.ts';
import { Route as HelpArticleRoute } from '../src/routes/help/$handle.tsx';
import { renderPageRouter } from './page-router.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../lib/start/graphql/execute-graphql.ts', () => ({ executeGraphQL }));

vi.mock('../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

const NOT_FOUND_TITLE = 'ページが見つかりません。';

const ERROR_MESSAGE =
  'ヘルプ記事を読み込めませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。';

const INTERNAL_ERROR = {
  ok: false,
  error: new GraphQLClientError({
    code: 'internal_error',
    message: 'サーバーでエラーが発生しました。',
    status: 500,
  }),
} as const;

const ARTICLE: HelpArticleView = {
  __typename: 'HelpArticle',
  handle: 'Upvote-Rules',
  title: 'Upvoteのルール',
  subtitle: '1日に何回Upvoteできるか',
  body: ['## はじめに', '', 'Upvoteの回数には上限があります。'].join('\n'),
  categoryName: '使い方',
  author: { nickname: '運営チームの佐藤', title: null, avatar: null },
  updatedAt: '2026-11-10T09:30:00.000Z',
  relatedArticles: [
    {
      handle: 'refund',
      title: '返金の条件',
      subtitle: '返金できる場合',
      pinned: false,
    },
  ],
};

const ok = (data: unknown) => ({ ok: true, data });

type ArticleResult = ClientHelpArticleQuery['helpArticle'];

// 照会のハンドルごとの結果。無いハンドルはnull(存在しない・下書き)
const respond = (results: Readonly<Record<string, ArticleResult>>) => {
  executeGraphQL.mockImplementation((document: unknown, variables: unknown) => {
    if (document === ClientHelpArticleDocument) {
      const { handle } = variables as { readonly handle: string };
      return Promise.resolve(ok({ helpArticle: results[handle] ?? null }));
    }
    return Promise.reject(new Error('想定外の文書の取得'));
  });
};

const articleCalls = () =>
  executeGraphQL.mock.calls.filter(
    ([called]) => called === ClientHelpArticleDocument,
  );

type PageHead = (input: {
  loaderData: HelpArticleLoaderData | undefined;
}) => ReturnType<typeof buildSitePageHead>;

// アプリの経路と同じ取得・画面を通すため、本物の経路の設定を、画面のテスト用のルーターの同じパスの経路へ写す
const renderHelpArticle = (
  path: string,
  { pendingMs }: { pendingMs?: number } = {},
) =>
  renderPageRouter({
    path,
    createRoutes: (rootRoute) => [
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/help/$handle',
        loader: HelpArticleRoute.options.loader,
        pendingComponent: HelpArticleRoute.options.pendingComponent,
        errorComponent: HelpArticleRoute.options.errorComponent,
        notFoundComponent: HelpArticleRoute.options.notFoundComponent,
        component: HelpArticleRoute.options.component,
        ...(pendingMs === undefined ? {} : { pendingMs }),
      } as Parameters<typeof createRoute>[0]),
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/help',
        component: () => <h1>ヘルプ</h1>,
      }),
    ],
  });

const main = () => page.getByRole('main');
const pageTitle = () => main().getByRole('heading', { level: 1 });
const searchInput = () =>
  main().getByRole('searchbox', { name: '検索キーワード' });
const backToTop = () =>
  main().getByRole('link', { name: 'ヘルプトップへ戻る' });

const expectNotFound = async (): Promise<void> => {
  await expect.element(pageTitle()).toHaveTextContent(NOT_FOUND_TITLE);
  await expect
    .element(main().getByRole('link', { name: 'トップページへ' }))
    .toHaveAttribute('href', '/');
};

beforeEach(async () => {
  executeGraphQL.mockReset();
  await emulateBrowserDisplay({ timeZone: 'Asia/Tokyo', locale: 'ja-JP' });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await emulateBrowserDisplay(null);
});

describe('ヘルプ記事詳細の経路', () => {
  test('公開の記事を大文字小文字の違うURLで開いても転送せずに表示し、URLのハンドルで照会する', async () => {
    respond({ 'UPVOTE-rules': ARTICLE });

    const router = await renderHelpArticle('/help/UPVOTE-rules');

    await expect.element(pageTitle()).toHaveTextContent('Upvoteのルール');
    await expect.element(main().getByText('使い方').first()).toBeVisible();
    await expect
      .element(main().getByText('1日に何回Upvoteできるか'))
      .toBeVisible();
    await expect.element(main().getByText('運営チームの佐藤')).toBeVisible();
    await expect
      .element(main().getByRole('heading', { level: 2, name: 'はじめに' }))
      .toBeVisible();
    await expect
      .element(main().getByRole('link', { name: '返金の条件' }))
      .toHaveAttribute('href', '/help/refund');
    await expect.element(searchInput()).toHaveValue('');
    await expect.element(backToTop()).toHaveAttribute('href', '/help');
    expect(router.state.location.pathname).toBe('/help/UPVOTE-rules');
    expect(articleCalls()).toHaveLength(1);
    expect(articleCalls()[0]?.[1]).toEqual({ handle: 'UPVOTE-rules' });
    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test.each(['a b', 'a.b', '-abc', 'ヘルプ', 'a'.repeat(51)])(
    'ハンドルの形式違反(%p)は照会せずに、他のページと同じ存在しないページの画面にする',
    async (handle) => {
      await renderHelpArticle(`/help/${encodeURIComponent(handle)}`);

      await expectNotFound();
      expect(executeGraphQL).not.toHaveBeenCalled();
    },
  );

  test('存在しない・下書きの記事のハンドル(null)は、同じ存在しないページの画面にする', async () => {
    respond({});

    await renderHelpArticle('/help/draft-article');

    await expectNotFound();
    expect(articleCalls()).toHaveLength(1);
    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test('旧ハンドルのURLは、クエリを保ったまま現在のハンドルのURLへ転送し、現在のハンドルで表示する', async () => {
    respond({
      'old-rules': {
        __typename: 'HelpArticleRedirect',
        handle: 'Upvote-Rules',
      },
      'Upvote-Rules': ARTICLE,
    });

    const router = await renderHelpArticle(
      '/help/old-rules?utm_source=share&ref=mail',
    );

    await expect.element(pageTitle()).toHaveTextContent('Upvoteのルール');
    expect(router.state.location.pathname).toBe('/help/Upvote-Rules');
    expect(router.state.location.search).toEqual({
      utm_source: 'share',
      ref: 'mail',
    });
  });

  test('初回の読み込み中は、検索欄とヘルプトップへ戻る導線を残し、読み込み中の旨を伝えるスケルトンを出す', async () => {
    executeGraphQL.mockReturnValue(new Promise<never>(() => undefined));

    await renderHelpArticle('/help/Upvote-Rules', { pendingMs: 0 });

    await expect
      .element(main().getByRole('status'))
      .toHaveTextContent('ヘルプ記事を読み込み中');
    await expect.element(searchInput()).toBeVisible();
    await expect.element(backToTop()).toBeVisible();
    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test('取得の失敗では、検索欄とヘルプトップへ戻る導線の下に再試行と問い合わせの導線を示し、再試行で表示し直して記事の見出しへフォーカスを移す', async () => {
    executeGraphQL.mockResolvedValue(INTERNAL_ERROR);

    await renderHelpArticle('/help/Upvote-Rules');

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(ERROR_MESSAGE);
    await expect
      .element(main().getByRole('link', { name: 'お問い合わせ' }))
      .toHaveAttribute('href', '/contact');
    await expect.element(searchInput()).toBeVisible();
    await expect.element(backToTop()).toBeVisible();
    await expect.element(pageTitle()).toHaveTextContent('ヘルプ記事詳細');
    expect(await runAxe(document.body)).toStrictEqual([]);

    respond({ 'Upvote-Rules': ARTICLE });
    await userEvent.click(main().getByRole('button', { name: '再試行' }));

    await expect.element(pageTitle()).toHaveTextContent('Upvoteのルール');
    await expect.element(pageTitle()).toHaveFocus();
    expect(main().getByRole('alert').query()).toBeNull();
  });

  test('再試行も失敗したら、失敗の画面の見出しへフォーカスを移して<body>へ落とさない', async () => {
    executeGraphQL.mockResolvedValue(INTERNAL_ERROR);
    await renderHelpArticle('/help/Upvote-Rules');
    await expect.element(main().getByRole('alert')).toBeVisible();

    await userEvent.click(main().getByRole('button', { name: '再試行' }));

    await expect.poll(() => articleCalls().length).toBe(2);
    await expect.element(pageTitle()).toHaveTextContent('ヘルプ記事詳細');
    await expect.element(pageTitle()).toHaveFocus();
    await expect.element(main().getByRole('alert')).toBeVisible();
  });

  test('表示中に取り直した記事が表示できなくなったら(下書きへ戻した・削除した)、存在しないページの画面にする', async () => {
    respond({ 'Upvote-Rules': ARTICLE });
    const router = await renderHelpArticle('/help/Upvote-Rules');
    await expect.element(pageTitle()).toHaveTextContent('Upvoteのルール');

    respond({});
    await router.options.context.queryClient.invalidateQueries({
      queryKey: helpArticleQueryOptions('Upvote-Rules').queryKey,
    });

    await expectNotFound();
  });
});

describe('ヘルプ記事詳細のhead', () => {
  const head = HelpArticleRoute.options.head as PageHead | undefined;

  test('タイトルに記事のタイトル、正規のURLに現在のハンドルの表記のパスを出す', () => {
    const result = head?.({
      loaderData: { handle: 'Upvote-Rules', title: 'Upvoteのルール' },
    });

    expect(result?.meta).toStrictEqual([
      { title: 'Upvoteのルール | Launch Stadium' },
    ]);
    expect(result?.links).toStrictEqual([
      { rel: 'canonical', href: '/help/Upvote-Rules' },
    ]);
  });

  test('取得の前や失敗ではサイト名だけにし、正規のURLを付けない', () => {
    const result = head?.({ loaderData: undefined });

    expect(result?.meta).toStrictEqual([{ title: 'Launch Stadium' }]);
    expect(result?.links).toStrictEqual([]);
  });
});
