import { createRoute } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../src/styles.css';
import { runAxe } from '../lib/test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../lib/test/display-emulation.ts';
import type { DisplayPreferences } from '../lib/utilities/datetime/display-preferences.ts';
import { GraphQLClientError } from '../lib/utilities/graphql/graphql-result.ts';
import {
  ClientMyFollowersDocument,
  type ClientMyFollowersQuery,
  ClientMyFollowingDocument,
  type ClientMyFollowingQuery,
  type ClientMyFollowingQueryVariables,
} from '../src/graphql/generated/graphql.ts';
import type { buildSitePageHead } from '../src/head/page-heads.ts';
import { Route as AuthenticatedRoute } from '../src/routes/_authenticated/route.tsx';
import { Route as FollowsSettingsRoute } from '../src/routes/_authenticated/settings/follows.tsx';
import { Route as SettingsRoute } from '../src/routes/_authenticated/settings/route.tsx';
import {
  createPageRouterContext,
  type PageRootRoute,
  renderPageRouter,
} from './page-router.tsx';
import { signedInViewerQuery } from './viewer-fixtures.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../lib/start/graphql/execute-graphql.ts', () => ({ executeGraphQL }));

const TOKYO_JA: DisplayPreferences = {
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
};

const FOLLOWS_PATH = '/settings/follows';

const FOLLOWERS_PATH = '/settings/follows?tab=followers';

const PAGE_SIZE = 20;

type FollowNode = ClientMyFollowingQuery['myFollowing']['nodes'][number];

const MAKER: FollowNode = {
  user: { handle: 'maker_ai', nickname: 'メーカーAI', avatar: null },
  followedAt: '2026-11-05T02:30:00.000Z',
};

const SCOUT: FollowNode = {
  user: { handle: 'scout_ken', nickname: 'スカウトKen', avatar: null },
  followedAt: '2026-11-03T01:00:00.000Z',
};

const LOAD_FAILURE = new GraphQLClientError({
  code: 'internal_error',
  message: 'サーバーでエラーが発生しました。',
  status: 500,
});

const connectionOf = (
  nodes: readonly FollowNode[],
  endCursor: string | null = null,
) => ({
  nodes: [...nodes],
  pageInfo: { endCursor, hasNextPage: endCursor !== null },
});

const followsResult = (
  nodes: readonly FollowNode[],
  endCursor: string | null = null,
) => ({
  ok: true,
  data: {
    myFollowing: connectionOf(nodes, endCursor),
  } satisfies ClientMyFollowingQuery,
});

const followersResult = (
  nodes: readonly FollowNode[],
  endCursor: string | null = null,
) => ({
  ok: true,
  data: {
    myFollowers: connectionOf(nodes, endCursor),
  } satisfies ClientMyFollowersQuery,
});

const usersFrom = (start: number, count: number): FollowNode[] =>
  Array.from({ length: count }, (_, index) => ({
    ...MAKER,
    user: {
      ...MAKER.user,
      handle: `user_${(start + index).toString()}`,
      nickname: `ユーザー${(start + index).toString()}`,
    },
  }));

type Responder = (
  variables: ClientMyFollowingQueryVariables,
) => Promise<unknown>;

const respond = (following: Responder, followers: Responder = following) => {
  executeGraphQL.mockImplementation(
    (document: unknown, variables: ClientMyFollowingQueryVariables) => {
      if (document === ClientMyFollowingDocument) {
        return following(variables);
      }
      if (document === ClientMyFollowersDocument) {
        return followers(variables);
      }
      throw new Error('想定していない操作が実行されました。');
    },
  );
};

const respondWith = (
  following: readonly FollowNode[],
  followers: readonly FollowNode[] = [],
) => {
  respond(
    () => Promise.resolve(followsResult(following)),
    () => Promise.resolve(followersResult(followers)),
  );
};

const callsOf = (document: unknown) =>
  executeGraphQL.mock.calls.filter(([called]) => called === document);

// アプリの経路と同じ判定・レイアウト・画面を通すため、本物の経路の設定を、画面のテスト用のルーターの同じIDの経路へ写す
const createRoutes = (rootRoute: PageRootRoute) => {
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_authenticated',
    beforeLoad: AuthenticatedRoute.options.beforeLoad,
  });
  const settingsRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: 'settings',
    component: SettingsRoute.options.component,
  });
  return [
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/auth/login',
      component: () => <h1>ログイン</h1>,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/@{$handle}',
      component: () => <h1>公開プロフィール</h1>,
    }),
    authenticatedRoute.addChildren([
      settingsRoute.addChildren([
        createRoute({
          getParentRoute: () => settingsRoute,
          path: 'follows',
          validateSearch: FollowsSettingsRoute.options.validateSearch,
          loaderDeps: FollowsSettingsRoute.options.loaderDeps,
          loader: FollowsSettingsRoute.options.loader,
          component: FollowsSettingsRoute.options.component,
        } as Parameters<typeof createRoute>[0]),
      ]),
    ]),
  ];
};

const renderFollows = ({
  path = FOLLOWS_PATH,
  signedIn = true,
}: { readonly path?: string; readonly signedIn?: boolean } = {}) =>
  renderPageRouter({
    path,
    createRoutes,
    context: createPageRouterContext('local'),
    ...(signedIn ? { cachedViewer: signedInViewerQuery() } : {}),
  });

const main = () => page.getByRole('main');
const pageTitle = () => main().getByRole('heading', { level: 1 });
const tabList = () => main().getByRole('tablist', { name: 'フォロー一覧' });
const followingTab = () => tabList().getByRole('tab', { name: 'フォロー中' });
const followersTab = () => tabList().getByRole('tab', { name: 'フォロワー' });
const panel = () => main().getByRole('tabpanel');
const entries = () => panel().getByRole('listitem');
const loadMoreButton = () =>
  panel().getByRole('button', { name: 'さらに読み込む' });
const settingsNavigation = () => page.getByRole('navigation', { name: '設定' });

type PageHead = ReturnType<typeof buildSitePageHead>;

const deferred = <T,>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

beforeEach(async () => {
  executeGraphQL.mockReset();
  await emulateBrowserDisplay(TOKYO_JA);
});

afterEach(async () => {
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('フォロー一覧の経路', () => {
  test('未ログインでは、フォロー一覧のパスを戻り先にしたログイン画面へ移し、一覧を取得しない', async () => {
    const router = await renderFollows({ signedIn: false });

    await expect.element(pageTitle()).toHaveTextContent('ログイン');
    expect(router.state.location.search).toEqual({ redirect: FOLLOWS_PATH });
    expect(executeGraphQL).not.toHaveBeenCalled();
  });

  test('設定のナビゲーションの中に描き、「フォロー」を現在の項目として示す', async () => {
    respondWith([MAKER]);

    await renderFollows();

    await expect.element(pageTitle()).toHaveTextContent(/^フォロー$/);
    await expect
      .element(
        settingsNavigation().getByRole('link', {
          name: 'フォロー',
          exact: true,
        }),
      )
      .toHaveAttribute('aria-current', 'page');
  });

  test('「フォロー中」を既定のタブにして、フォロー中の一覧だけを取得する', async () => {
    respondWith([MAKER], [SCOUT]);

    await renderFollows();

    await expect
      .element(followingTab())
      .toHaveAttribute('aria-selected', 'true');
    await expect
      .element(followersTab())
      .toHaveAttribute('aria-selected', 'false');
    await expect.element(entries().first()).toHaveTextContent('メーカーAI');
    expect(callsOf(ClientMyFollowingDocument)).toHaveLength(1);
    expect(callsOf(ClientMyFollowersDocument)).toHaveLength(0);
  });

  test('tabがfollowersならフォロワーのタブを選び、フォロワーの一覧を取得する', async () => {
    respondWith([MAKER], [SCOUT]);

    await renderFollows({ path: FOLLOWERS_PATH });

    await expect
      .element(followersTab())
      .toHaveAttribute('aria-selected', 'true');
    await expect.element(entries().first()).toHaveTextContent('スカウトKen');
    expect(callsOf(ClientMyFollowingDocument)).toHaveLength(0);
    expect(callsOf(ClientMyFollowersDocument)).toHaveLength(1);
  });

  test('tabが未登録の値なら、フォロー中のタブにする', async () => {
    respondWith([MAKER], [SCOUT]);

    await renderFollows({ path: `${FOLLOWS_PATH}?tab=launches` });

    await expect
      .element(followingTab())
      .toHaveAttribute('aria-selected', 'true');
    await expect.element(entries().first()).toHaveTextContent('メーカーAI');
  });

  test('フォロワーへ切り替えるとtabに保持し、フォロー中へ戻すとクエリを省く', async () => {
    respondWith([MAKER], [SCOUT]);
    const router = await renderFollows();
    await expect.element(entries().first()).toHaveTextContent('メーカーAI');
    expect(router.state.location.searchStr).toBe('');

    await userEvent.click(followersTab());

    await expect
      .element(followersTab())
      .toHaveAttribute('aria-selected', 'true');
    await expect.element(entries().first()).toHaveTextContent('スカウトKen');
    expect(router.state.location.searchStr).toBe('?tab=followers');

    await userEvent.click(followingTab());

    await expect
      .element(followingTab())
      .toHaveAttribute('aria-selected', 'true');
    await expect.element(entries().first()).toHaveTextContent('メーカーAI');
    expect(router.state.location.searchStr).toBe('');
  });

  test('ブラウザの戻る操作で、前のタブへ復元する', async () => {
    respondWith([MAKER], [SCOUT]);
    const router = await renderFollows();
    await userEvent.click(followersTab());
    await expect.element(entries().first()).toHaveTextContent('スカウトKen');

    router.history.back();

    await expect
      .element(followingTab())
      .toHaveAttribute('aria-selected', 'true');
    await expect.element(entries().first()).toHaveTextContent('メーカーAI');
  });

  test('項目ごとに、プロフィール画像・ニックネーム・@付きのハンドル・フォローした日時を示し、項目全体を公開プロフィールへのリンクにする', async () => {
    respondWith([MAKER, SCOUT]);

    await renderFollows();

    await expect.poll(() => entries().elements()).toHaveLength(2);
    const maker = entries().nth(0);
    const link = maker.getByRole('link');
    await expect.element(link).toHaveAttribute('href', '/@maker_ai');
    await expect.element(link).toHaveTextContent('メーカーAI');
    await expect.element(link).toHaveTextContent('@maker_ai');
    await expect
      .element(link)
      .toHaveTextContent('フォローした日時 2026年11月5日(木) 11:30');
    await expect
      .element(link.getByText('2026年11月5日(木) 11:30'))
      .toHaveAttribute('datetime', '2026-11-05T02:30:00.000Z');
    expect(
      link
        .element()
        .querySelector(
          '[data-slot="media-placeholder"], img, svg, [role="img"]',
        ),
    ).not.toBeNull();
    await expect.element(entries().nth(1)).toHaveTextContent('スカウトKen');
  });

  test('フォロワーの一覧の日時は「フォローされた日時」として示す', async () => {
    respondWith([], [SCOUT]);

    await renderFollows({ path: FOLLOWERS_PATH });

    await expect
      .element(entries().first())
      .toHaveTextContent('フォローされた日時 2026年11月3日(火) 10:00');
  });

  test('項目のリンクを押すと、その利用者の公開プロフィールへ移る', async () => {
    respondWith([MAKER]);
    const router = await renderFollows();

    await userEvent.click(entries().first().getByRole('link'));

    await expect.element(pageTitle()).toHaveTextContent('公開プロフィール');
    expect(router.state.location.pathname).toBe('/@maker_ai');
  });

  test('最初は20件を読み、「さらに読み込む」で続きの20件を後ろに加えて、加えた最初の項目へフォーカスを移す', async () => {
    const pending = deferred<unknown>();
    respond((variables) =>
      variables.after === undefined
        ? Promise.resolve(followsResult(usersFrom(0, PAGE_SIZE), 'cursor-2'))
        : variables.after === 'cursor-2'
          ? pending.promise
          : Promise.resolve(followsResult(usersFrom(PAGE_SIZE * 2, 1))),
    );

    await renderFollows();

    await expect.poll(() => entries().elements()).toHaveLength(PAGE_SIZE);
    expect(executeGraphQL).toHaveBeenCalledWith(
      ClientMyFollowingDocument,
      { first: PAGE_SIZE },
      expect.anything(),
    );

    await userEvent.click(loadMoreButton());

    const busy = panel().getByRole('button', { name: '読み込み中' });
    await expect.element(busy).toHaveAttribute('aria-busy', 'true');
    await expect.element(busy).toHaveAttribute('aria-disabled', 'true');
    await expect.element(busy).toHaveFocus();
    expect(executeGraphQL).toHaveBeenCalledWith(
      ClientMyFollowingDocument,
      { first: PAGE_SIZE, after: 'cursor-2' },
      expect.anything(),
    );

    pending.resolve(followsResult(usersFrom(PAGE_SIZE, PAGE_SIZE), 'cursor-3'));

    await expect.poll(() => entries().elements()).toHaveLength(PAGE_SIZE * 2);
    await expect.element(entries().nth(PAGE_SIZE)).toHaveFocus();
    await expect.element(loadMoreButton()).toBeVisible();
  });

  test('フォロワーの一覧もカーソルで続きを読む', async () => {
    respond(
      () => Promise.resolve(followsResult([])),
      (variables) =>
        Promise.resolve(
          variables.after === undefined
            ? followersResult(usersFrom(0, PAGE_SIZE), 'cursor-2')
            : followersResult(usersFrom(PAGE_SIZE, 1)),
        ),
    );

    await renderFollows({ path: FOLLOWERS_PATH });
    await expect.poll(() => entries().elements()).toHaveLength(PAGE_SIZE);
    await userEvent.click(loadMoreButton());

    await expect.poll(() => entries().elements()).toHaveLength(PAGE_SIZE + 1);
    expect(executeGraphQL).toHaveBeenCalledWith(
      ClientMyFollowersDocument,
      { first: PAGE_SIZE, after: 'cursor-2' },
      expect.anything(),
    );
  });

  test('最後のページを読み込むと「さらに読み込む」を消し、フォーカスを加えた最初の項目へ移す', async () => {
    respond((variables) =>
      Promise.resolve(
        variables.after === undefined
          ? followsResult([MAKER], 'cursor-2')
          : followsResult([SCOUT]),
      ),
    );

    await renderFollows();
    await userEvent.click(loadMoreButton());

    await expect.poll(() => entries().elements()).toHaveLength(2);
    await expect.element(entries().nth(1)).toHaveFocus();
    expect(loadMoreButton().elements()).toHaveLength(0);
  });

  test('続きが無ければ「さらに読み込む」を置かない', async () => {
    respondWith([MAKER]);

    await renderFollows();

    await expect.poll(() => entries().elements()).toHaveLength(1);
    expect(loadMoreButton().elements()).toHaveLength(0);
  });

  test('続きを待つ間に利用者が設定のナビゲーションへフォーカスを移すと、読み込んだ後もフォーカスを奪い返さない', async () => {
    const pending = deferred<unknown>();
    respond((variables) =>
      variables.after === undefined
        ? Promise.resolve(followsResult([MAKER], 'cursor-2'))
        : pending.promise,
    );

    await renderFollows();
    await userEvent.click(loadMoreButton());
    await expect
      .element(panel().getByRole('button', { name: '読み込み中' }))
      .toHaveFocus();

    const navigationLink = settingsNavigation().getByRole('link', {
      name: 'プロフィール',
    });
    (navigationLink.element() as HTMLElement).focus();
    pending.resolve(followsResult([SCOUT]));

    await expect.poll(() => entries().elements()).toHaveLength(2);
    await expect.element(navigationLink).toHaveFocus();
  });

  test('フォロー中が0件なら、その旨を示す', async () => {
    respondWith([], [SCOUT]);

    await renderFollows();

    await expect
      .element(panel().getByText('まだフォローしているユーザーはいません。'))
      .toBeVisible();
    expect(entries().elements()).toHaveLength(0);
    expect(loadMoreButton().elements()).toHaveLength(0);
  });

  test('フォロワーが0件なら、その旨を示す', async () => {
    respondWith([MAKER], []);

    await renderFollows({ path: FOLLOWERS_PATH });

    await expect
      .element(panel().getByText('まだフォロワーはいません。'))
      .toBeVisible();
  });

  test('最初の読み込みの失敗は題名とタブを残したまま示し、再試行で題名へフォーカスを移して取得し直す', async () => {
    let failing = true;
    respond(() =>
      Promise.resolve(
        failing ? { ok: false, error: LOAD_FAILURE } : followsResult([MAKER]),
      ),
    );

    await renderFollows();

    await expect
      .element(panel().getByRole('alert'))
      .toHaveTextContent(
        'フォロー一覧を読み込めませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。',
      );
    await expect.element(pageTitle()).toHaveTextContent(/^フォロー$/);
    await expect.element(tabList()).toBeVisible();
    await expect
      .element(panel().getByRole('link', { name: 'お問い合わせ' }))
      .toBeVisible();

    failing = false;
    await userEvent.click(panel().getByRole('button', { name: '再試行' }));

    await expect.element(entries().first()).toHaveTextContent('メーカーAI');
    await expect.element(pageTitle()).toHaveFocus();
  });

  test('フォロー中の取得の失敗の後も、フォロワーのタブを取得して示せる', async () => {
    respond(
      () => Promise.resolve({ ok: false, error: LOAD_FAILURE }),
      () => Promise.resolve(followersResult([SCOUT])),
    );
    await renderFollows();
    await expect.element(panel().getByRole('alert')).toBeVisible();

    await userEvent.click(followersTab());

    await expect.element(entries().first()).toHaveTextContent('スカウトKen');
    expect(panel().getByRole('alert').elements()).toHaveLength(0);
  });

  test('続きの読み込みの失敗は読み込んだ項目を残したまま「続きを読み込めませんでした。」と示し、再試行で読み込み直せる', async () => {
    let failing = true;
    respond((variables) =>
      Promise.resolve(
        variables.after === undefined
          ? followsResult([MAKER], 'cursor-2')
          : failing
            ? { ok: false, error: LOAD_FAILURE }
            : followsResult([SCOUT]),
      ),
    );

    await renderFollows();
    await userEvent.click(loadMoreButton());

    await expect
      .element(panel().getByRole('alert'))
      .toHaveTextContent('続きを読み込めませんでした。');
    expect(entries().elements()).toHaveLength(1);
    await expect.element(loadMoreButton()).toHaveFocus();

    failing = false;
    await userEvent.click(panel().getByRole('button', { name: '再試行' }));

    await expect.poll(() => entries().elements()).toHaveLength(2);
    expect(panel().getByRole('alert').elements()).toHaveLength(0);
    await expect.element(entries().nth(1)).toHaveFocus();
  });

  test('続きの読み込みの失敗の後は、「さらに読み込む」でも読み込み直せる', async () => {
    let failing = true;
    respond((variables) =>
      Promise.resolve(
        variables.after === undefined
          ? followsResult([MAKER], 'cursor-2')
          : failing
            ? { ok: false, error: LOAD_FAILURE }
            : followsResult([SCOUT]),
      ),
    );

    await renderFollows();
    await userEvent.click(loadMoreButton());
    await expect.element(panel().getByRole('alert')).toBeVisible();

    failing = false;
    await userEvent.click(loadMoreButton());

    await expect.poll(() => entries().elements()).toHaveLength(2);
  });

  test('フォロー一覧のページのタイトルは「フォロー」で、検索エンジンに登録させない', () => {
    const head = FollowsSettingsRoute.options.head as
      (() => PageHead) | undefined;
    const meta = head?.().meta ?? [];

    expect(meta).toContainEqual({ title: 'フォロー | Launch Stadium' });
    expect(meta).toContainEqual({
      name: 'robots',
      content: 'noindex, nofollow',
    });
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('項目と続きの読み込みの表示で、アクセシビリティの検査の違反が0件', async () => {
      respond(() => Promise.resolve(followsResult([MAKER, SCOUT], 'cursor-2')));
      await renderFollows();
      await expect.element(loadMoreButton()).toBeVisible();

      expect(await runAxe(main().element())).toStrictEqual([]);
    });

    test('フォロワーのタブの表示で、アクセシビリティの検査の違反が0件', async () => {
      respondWith([MAKER], [SCOUT]);
      await renderFollows({ path: FOLLOWERS_PATH });
      await expect.element(entries().first()).toBeVisible();

      expect(await runAxe(main().element())).toStrictEqual([]);
    });

    test('0件の表示で、アクセシビリティの検査の違反が0件', async () => {
      respondWith([]);
      await renderFollows();
      await expect
        .element(panel().getByText('まだフォローしているユーザーはいません。'))
        .toBeVisible();

      expect(await runAxe(main().element())).toStrictEqual([]);
    });

    test('読み込みの失敗の表示で、アクセシビリティの検査の違反が0件', async () => {
      respond(() => Promise.resolve({ ok: false, error: LOAD_FAILURE }));
      await renderFollows();
      await expect.element(panel().getByRole('alert')).toBeVisible();

      expect(await runAxe(main().element())).toStrictEqual([]);
    });

    test('続きの読み込みの失敗の表示で、アクセシビリティの検査の違反が0件', async () => {
      respond((variables) =>
        Promise.resolve(
          variables.after === undefined
            ? followsResult([MAKER], 'cursor-2')
            : { ok: false, error: LOAD_FAILURE },
        ),
      );
      await renderFollows();
      await userEvent.click(loadMoreButton());
      await expect.element(panel().getByRole('alert')).toBeVisible();

      expect(await runAxe(main().element())).toStrictEqual([]);
    });
  });
});
