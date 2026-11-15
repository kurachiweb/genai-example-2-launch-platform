import { createRoute } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../src/styles.css';
import { runAxe } from '../lib/test/a11y.ts';
import { GraphQLClientError } from '../lib/utilities/graphql/graphql-result.ts';
import {
  ClientHelpArticleSearchDocument,
  type ClientHelpArticleSearchQuery,
  ClientHelpCenterDocument,
  type ClientHelpCenterQuery,
} from '../src/graphql/generated/graphql.ts';
import type { buildSitePageHead } from '../src/head/page-heads.ts';
import { Route as HelpTopRoute } from '../src/routes/help/index.tsx';
import { renderPageRouter } from './page-router.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../lib/start/graphql/execute-graphql.ts', () => ({ executeGraphQL }));

vi.mock('../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

const ERROR_MESSAGE =
  'ヘルプを読み込めませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。';

const INTERNAL_ERROR = {
  ok: false,
  error: new GraphQLClientError({
    code: 'internal_error',
    message: 'サーバーでエラーが発生しました。',
    status: 500,
  }),
} as const;

const HELP_CENTER: ClientHelpCenterQuery = {
  helpCenter: [
    {
      name: '使い方',
      articles: [
        {
          handle: 'upvote-rules',
          title: 'Upvoteのルール',
          subtitle: '1日に何回Upvoteできるか',
          pinned: true,
        },
      ],
    },
  ],
};

const hitsFor = (query: string): ClientHelpArticleSearchQuery => ({
  helpArticleSearch: [
    {
      handle: `hit-${String(query.length)}`,
      title: `${query}の記事`,
      subtitle: '検索で見つかった記事',
      categoryName: '使い方',
    },
  ],
});

const ok = (data: unknown) => ({ ok: true, data });

// 検索語ごとに差し替える検索の応答。無い検索語は1件の結果を返す
type SearchOverrides = Readonly<Record<string, () => Promise<unknown>>>;

// ヘルプトップには指定の結果を、検索には検索語ごとの1件の結果を返す
const respond = (
  helpCenter: ClientHelpCenterQuery | typeof INTERNAL_ERROR = HELP_CENTER,
  searches: SearchOverrides = {},
) => {
  executeGraphQL.mockImplementation((document: unknown, variables: unknown) => {
    if (document === ClientHelpCenterDocument) {
      return Promise.resolve('ok' in helpCenter ? helpCenter : ok(helpCenter));
    }
    if (document === ClientHelpArticleSearchDocument) {
      const { query } = variables as { readonly query: string };
      return searches[query]?.() ?? Promise.resolve(ok(hitsFor(query)));
    }
    return Promise.reject(new Error('想定外の文書の取得'));
  });
};

const deferred = () => {
  let resolve: (value: unknown) => void = () => undefined;
  const promise = new Promise<unknown>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

// 直前の結果の項目を囲む、再読み込みの間の印の付いた要素
const closestOf = (text: string, selector: string): Element | null =>
  [...document.querySelectorAll('main li a')]
    .find((link) => link.textContent.includes(text))
    ?.closest(selector) ?? null;

const callsOf = (document: unknown) =>
  executeGraphQL.mock.calls.filter(([called]) => called === document);

// 検索の取得ごとの変数
const searchVariables = (): readonly unknown[] =>
  callsOf(ClientHelpArticleSearchDocument).map(
    ([, variables]): unknown => variables,
  );

type PageHead = () => ReturnType<typeof buildSitePageHead>;

// アプリの経路と同じ検証・取得・画面を通すため、本物の経路の設定を、画面のテスト用のルーターの同じ識別子(/help/)の経路へ写す
const renderHelpTop = (
  path: string,
  { pendingMs }: { pendingMs?: number } = {},
) =>
  renderPageRouter({
    path,
    createRoutes: (rootRoute) => {
      const parent = createRoute({
        getParentRoute: () => rootRoute,
        path: 'help',
      });
      return [
        parent.addChildren([
          createRoute({
            getParentRoute: () => parent,
            path: '/',
            validateSearch: HelpTopRoute.options.validateSearch,
            loaderDeps: HelpTopRoute.options.loaderDeps,
            loader: HelpTopRoute.options.loader,
            pendingComponent: HelpTopRoute.options.pendingComponent,
            errorComponent: HelpTopRoute.options.errorComponent,
            component: HelpTopRoute.options.component,
            ...(pendingMs === undefined ? {} : { pendingMs }),
          } as Parameters<typeof createRoute>[0]),
        ]),
      ];
    },
  });

const main = () => page.getByRole('main');
const pageTitle = () => main().getByRole('heading', { level: 1 });
const searchInput = () =>
  main().getByRole('searchbox', { name: '検索キーワード' });
const categoryRegion = () => main().getByRole('region', { name: '使い方' });
const resultsHeading = (query: string) =>
  main().getByRole('heading', { level: 2, name: `「${query}」の検索結果` });

beforeEach(() => {
  executeGraphQL.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ヘルプトップの経路', () => {
  test('検索語が無ければ、見出し「ヘルプ」・空の検索欄・カテゴリ別の一覧を示し、検索しない', async () => {
    respond();

    await renderHelpTop('/help');

    await expect.element(pageTitle()).toHaveTextContent('ヘルプ');
    await expect.element(searchInput()).toHaveValue('');
    await expect
      .element(categoryRegion().getByRole('link'))
      .toHaveAttribute('href', '/help/upvote-rules');
    expect(callsOf(ClientHelpCenterDocument)).toHaveLength(1);
    expect(callsOf(ClientHelpArticleSearchDocument)).toHaveLength(0);
    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test('空白だけの検索語は、検索語の無いURLへ置き換えてカテゴリ別の一覧を示す', async () => {
    respond();

    const router = await renderHelpTop('/help?q=%20%E3%80%80');

    await expect.element(categoryRegion()).toBeVisible();
    await expect.poll(() => router.state.location.href).toBe('/help');
    expect(callsOf(ClientHelpArticleSearchDocument)).toHaveLength(0);
  });

  test('URLの検索語があれば、その検索語で検索した結果と検索欄の値を示し、カテゴリ別の一覧は取得しない', async () => {
    respond();

    await renderHelpTop('/help?q=Upvote');

    await expect.element(resultsHeading('Upvote')).toBeVisible();
    await expect.element(searchInput()).toHaveValue('Upvote');
    await expect
      .element(main().getByRole('link', { name: /^Upvoteの記事/u }))
      .toBeVisible();
    expect(searchVariables()).toEqual([{ query: 'Upvote' }]);
    expect(callsOf(ClientHelpCenterDocument)).toHaveLength(0);
    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test('数として読まれる検索語も、文字列の検索語として検索する', async () => {
    respond();

    await renderHelpTop('/help?q=2026');

    await expect.element(resultsHeading('2026')).toBeVisible();
    expect(searchVariables()).toEqual([{ query: '2026' }]);
  });

  test('51文字の検索語は、エラーにせず前後の空白を除いた50文字に切り詰めて検索し、URLも切り詰める', async () => {
    respond();
    const long = `  ${'あ'.repeat(51)} `;

    const router = await renderHelpTop(`/help?q=${encodeURIComponent(long)}`);

    await expect.element(resultsHeading('あ'.repeat(50))).toBeVisible();
    expect(searchVariables()).toEqual([{ query: 'あ'.repeat(50) }]);
    await expect
      .poll((): unknown => router.state.location.search)
      .toEqual({ q: 'あ'.repeat(50) });
    await expect.element(searchInput()).toHaveValue('あ'.repeat(50));
  });

  test('検索欄から検索すると/help?q=へ移って結果を示し、戻る・進むで一覧と検索結果と検索欄の値を復元する', async () => {
    respond();
    const router = await renderHelpTop('/help');
    await expect.element(categoryRegion()).toBeVisible();

    await userEvent.fill(searchInput(), 'ピン留め');
    await userEvent.keyboard('{Enter}');

    await expect.element(resultsHeading('ピン留め')).toBeVisible();
    expect(router.state.location.search).toEqual({ q: 'ピン留め' });

    router.history.back();
    await expect.element(categoryRegion()).toBeVisible();
    await expect.element(searchInput()).toHaveValue('');

    router.history.forward();
    await expect.element(resultsHeading('ピン留め')).toBeVisible();
    await expect.element(searchInput()).toHaveValue('ピン留め');
    expect(callsOf(ClientHelpArticleSearchDocument)).toHaveLength(1);
  });

  test('同じページ内の検索は応答を待たずに移り、待つ間も入力欄にフォーカスを残して、直前の結果をinert・aria-busyで残し件数を「読み込み中…」にする', async () => {
    const next = deferred();
    respond(HELP_CENTER, { ピン留め: () => next.promise });
    const router = await renderHelpTop('/help?q=Upvote');
    await expect.element(resultsHeading('Upvote')).toBeVisible();

    await userEvent.fill(searchInput(), 'ピン留め');
    await userEvent.keyboard('{Enter}');

    await expect
      .poll((): unknown => router.state.location.search)
      .toEqual({ q: 'ピン留め' });
    await expect.element(main().getByText('読み込み中…')).toBeVisible();
    // ルーターが読み込み中の画面へ切り替える時間(1秒)を過ぎても、検索欄と直前の結果を残す
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await expect.element(searchInput()).toHaveFocus();
    expect(closestOf('Upvoteの記事', '[aria-busy="true"]')).not.toBeNull();
    expect(closestOf('Upvoteの記事', '[inert]')).not.toBeNull();
    expect(await runAxe(document.body)).toStrictEqual([]);

    next.resolve(ok(hitsFor('ピン留め')));

    await expect.element(resultsHeading('ピン留め')).toBeVisible();
    await expect.element(main().getByText('1件')).toBeVisible();
    expect(closestOf('ピン留めの記事', '[aria-busy="true"]')).toBeNull();
    expect(closestOf('ピン留めの記事', '[inert]')).toBeNull();
    await expect.element(searchInput()).toHaveFocus();
  });

  test('同じページ内の検索が失敗すると、一覧の位置に失敗を示して入力欄にフォーカスを残し、再試行で表示し直して見出しへフォーカスを移す', async () => {
    respond(HELP_CENTER, { ピン留め: () => Promise.resolve(INTERNAL_ERROR) });
    await renderHelpTop('/help?q=Upvote');
    await expect.element(resultsHeading('Upvote')).toBeVisible();

    await userEvent.fill(searchInput(), 'ピン留め');
    await userEvent.keyboard('{Enter}');

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(ERROR_MESSAGE);
    await expect.element(searchInput()).toHaveFocus();
    await expect.element(searchInput()).toHaveValue('ピン留め');
    await expect.element(pageTitle()).toHaveTextContent('ヘルプ');
    expect(await runAxe(document.body)).toStrictEqual([]);

    respond();
    await userEvent.click(main().getByRole('button', { name: '再試行' }));

    await expect.element(resultsHeading('ピン留め')).toBeVisible();
    await expect.element(pageTitle()).toHaveFocus();
    expect(main().getByRole('alert').query()).toBeNull();
  });

  test('初回の読み込み中は、見出しと検索欄を示し、一覧の位置に読み込み中の旨を伝えるスケルトンを出す', async () => {
    executeGraphQL.mockReturnValue(new Promise<never>(() => undefined));

    await renderHelpTop('/help?q=Upvote', { pendingMs: 0 });

    await expect
      .element(main().getByRole('status'))
      .toHaveTextContent('ヘルプ記事の一覧を読み込み中');
    await expect.element(pageTitle()).toHaveTextContent('ヘルプ');
    await expect.element(searchInput()).toHaveValue('Upvote');
    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test('取得の失敗では、見出しと検索欄を残して再試行と問い合わせの導線を示し、再試行で表示し直して見出しへフォーカスを移す', async () => {
    respond(INTERNAL_ERROR);

    await renderHelpTop('/help');

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(ERROR_MESSAGE);
    await expect
      .element(main().getByRole('link', { name: 'お問い合わせ' }))
      .toHaveAttribute('href', '/contact');
    await expect.element(pageTitle()).toHaveTextContent('ヘルプ');
    await expect.element(searchInput()).toBeVisible();
    expect(await runAxe(document.body)).toStrictEqual([]);

    respond();
    await userEvent.click(main().getByRole('button', { name: '再試行' }));

    await expect.element(categoryRegion()).toBeVisible();
    await expect.element(pageTitle()).toHaveFocus();
    expect(main().getByRole('alert').query()).toBeNull();
  });
});

describe('ヘルプトップのhead', () => {
  test('タイトルを「ヘルプ」にし、正規のURLを検索語の有無によらず/helpにする', () => {
    const head = HelpTopRoute.options.head as PageHead | undefined;

    const result = head?.();

    expect(result?.meta).toStrictEqual([{ title: 'ヘルプ | Launch Stadium' }]);
    expect(result?.links).toStrictEqual([{ rel: 'canonical', href: '/help' }]);
  });
});
