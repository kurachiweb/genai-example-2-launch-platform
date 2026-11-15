import { createRoute } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../src/styles.css';
import {
  lastTurnstileProps,
  resetFakeTurnstile,
} from '../lib/test/fake-turnstile.tsx';
import { runAxe } from '../lib/test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../lib/test/computed-style.ts';
import { GraphQLClientError } from '../lib/utilities/graphql/graphql-result.ts';
import { LOADING_LABEL } from '../lib/utilities/messages/state-messages.ts';
import {
  ClientFollowUserDocument,
  ClientPublicProfileDocument,
  type ClientPublicProfileQuery,
} from '../src/graphql/generated/graphql.ts';
import type { buildSitePageHead } from '../src/head/page-heads.ts';
import { Route as PublicProfileRoute } from '../src/routes/@{$handle}.tsx';
import { renderPageRouter } from './page-router.tsx';
import { signedInViewerQuery, VIEWER_HANDLE } from './viewer-fixtures.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../lib/start/graphql/execute-graphql.ts', () => ({ executeGraphQL }));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../lib/test/fake-turnstile.tsx'),
);

vi.mock('../src/composition/public-profile-sections.ts', async () => {
  const { createElement } = await import('react');
  return {
    PUBLIC_PROFILE_TABS: [
      {
        id: 'launches',
        label: 'ローンチ',
        order: 10,
        Panel: () => createElement('p', null, 'ローンチの内容'),
      },
      {
        id: 'upvotes',
        label: 'Upvote',
        order: 20,
        Panel: () => createElement('p', null, 'Upvoteの内容'),
      },
    ],
    PUBLIC_PROFILE_BADGES: [],
    PUBLIC_PROFILE_MENU_ITEMS: [],
  };
});

const WIDE_VIEWPORT_WIDTH = 1280;

const WIDE_VIEWPORT_HEIGHT = 900;

const ROUTE_PATH = '/@{$handle}';

const NOT_FOUND_TITLE = 'ページが見つかりません。';

const ERROR_MESSAGE =
  'プロフィールを読み込めませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。';

const profileOf = (
  overrides: Partial<
    Extract<
      NonNullable<ClientPublicProfileQuery['publicProfile']>,
      { __typename: 'PublicProfile' }
    >
  > = {},
): ClientPublicProfileQuery => ({
  publicProfile: {
    __typename: 'PublicProfile',
    handle: 'maker_ai',
    nickname: 'AIの作り手',
    headline: 'AIでプロダクトを作っています',
    bio: null,
    avatar: null,
    websites: [],
    followerCount: 12,
    ultras: false,
    suspended: false,
    viewerRelation: 'GUEST',
    ...overrides,
  },
});

const INTERNAL_ERROR = {
  ok: false,
  error: new GraphQLClientError({
    code: 'internal_error',
    message: 'サーバーでエラーが発生しました。',
    status: 500,
  }),
} as const;

const ok = (data: unknown) => ({ ok: true, data });

type PageHead = (input: {
  loaderData: { handle: string; nickname: string } | undefined;
}) => ReturnType<typeof buildSitePageHead>;

const callsOf = (document: unknown) =>
  executeGraphQL.mock.calls.filter(([called]) => called === document);

// アプリの経路と同じ検証・取得・画面を通すため、本物の経路の設定を、画面のテスト用のルーターの同じパスの経路へ写す
const renderProfile = (
  path: string,
  {
    signedIn = false,
    pendingMs,
  }: { signedIn?: boolean; pendingMs?: number } = {},
) =>
  renderPageRouter({
    path,
    ...(signedIn ? { cachedViewer: signedInViewerQuery() } : {}),
    createRoutes: (rootRoute) => [
      createRoute({
        getParentRoute: () => rootRoute,
        path: ROUTE_PATH,
        validateSearch: PublicProfileRoute.options.validateSearch,
        loader: PublicProfileRoute.options.loader,
        pendingComponent: PublicProfileRoute.options.pendingComponent,
        errorComponent: PublicProfileRoute.options.errorComponent,
        component: PublicProfileRoute.options.component,
        ...(pendingMs === undefined ? {} : { pendingMs }),
      } as Parameters<typeof createRoute>[0]),
    ],
  });

const main = () => page.getByRole('main');
const pageTitle = () => main().getByRole('heading', { level: 1 });

const respondByHandle = (
  profiles: Readonly<Record<string, ClientPublicProfileQuery>>,
) => {
  executeGraphQL.mockImplementation(
    (document: unknown, variables: { handle?: string }) => {
      if (
        document === ClientPublicProfileDocument &&
        variables.handle !== undefined
      ) {
        return Promise.resolve(
          ok(profiles[variables.handle] ?? { publicProfile: null }),
        );
      }
      return Promise.reject(new Error('想定外の文書の取得'));
    },
  );
};

beforeEach(() => {
  executeGraphQL.mockReset();
  resetFakeTurnstile();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('公開プロフィールの経路', () => {
  test('ログインせずに開き、ニックネームを見出し、@付きのハンドルとフォロワー数を表示する', async () => {
    respondByHandle({ maker_ai: profileOf() });

    await renderProfile('/@maker_ai');

    await expect.element(pageTitle()).toHaveTextContent('AIの作り手');
    await expect.element(main().getByText('@maker_ai')).toBeVisible();
    await expect.element(main().getByText('12')).toBeVisible();
    expect(callsOf(ClientPublicProfileDocument)).toHaveLength(1);
    expect(callsOf(ClientPublicProfileDocument)[0]?.[1]).toEqual({
      handle: 'maker_ai',
    });
  });

  test.each(['a b', 'a.b', '-abc', 'a'.repeat(26)])(
    'ハンドルの形式違反(%p)は照会せずに、存在しないページの画面にする',
    async (handle) => {
      await renderProfile(`/@${encodeURIComponent(handle)}`);

      await expect.element(pageTitle()).toHaveTextContent(NOT_FOUND_TITLE);
      expect(executeGraphQL).not.toHaveBeenCalled();
    },
  );

  test('存在しない・閲覧できないハンドル(null)は、存在しないページの画面にする', async () => {
    respondByHandle({});

    await renderProfile('/@nobody');

    await expect.element(pageTitle()).toHaveTextContent(NOT_FOUND_TITLE);
    expect(callsOf(ClientPublicProfileDocument)).toHaveLength(1);
  });

  test('旧ハンドルのURLは、現在のハンドルのURLへクエリを引き継いで転送し、現在のハンドルで表示する', async () => {
    respondByHandle({
      old_name: {
        publicProfile: {
          __typename: 'PublicProfileRedirect',
          handle: 'maker_ai',
        },
      },
      maker_ai: profileOf(),
    });

    const router = await renderProfile(
      '/@old_name?utm_source=share&tab=upvotes',
    );

    await expect.element(pageTitle()).toHaveTextContent('AIの作り手');
    expect(router.state.location.pathname).toBe('/@maker_ai');
    expect(router.state.location.search).toMatchObject({
      utm_source: 'share',
      tab: 'upvotes',
    });
  });

  test('ページのタイトルにニックネームと@付きのハンドルを含め、正規のURLを現在のハンドルの表記のパスにする', () => {
    const head = PublicProfileRoute.options.head as PageHead | undefined;
    const result = head?.({
      loaderData: { handle: 'Maker_AI', nickname: 'AIの作り手' },
    });

    expect(result?.meta).toContainEqual({
      title: 'AIの作り手(@Maker_AI) | Launch Stadium',
    });
    expect(result?.links).toContainEqual({
      rel: 'canonical',
      href: '/@Maker_AI',
    });
  });

  test('初回ローディング中は、人物情報の形を保ったスケルトンと読み込み中の表示を出す', async () => {
    executeGraphQL.mockReturnValue(new Promise<never>(() => undefined));

    await renderProfile('/@maker_ai', { pendingMs: 0 });

    await expect
      .element(main().getByRole('status'))
      .toHaveTextContent(LOADING_LABEL);
    expect(pageTitle().query()).toBeNull();
  });

  test('取得の失敗はページ全体を、再試行と問い合わせの導線に置き換え、再試行で表示し直して見出しへフォーカスを移す', async () => {
    executeGraphQL
      .mockResolvedValueOnce(INTERNAL_ERROR)
      .mockResolvedValue(ok(profileOf()));

    await renderProfile('/@maker_ai');

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(ERROR_MESSAGE);
    await expect
      .element(main().getByRole('link', { name: 'お問い合わせ' }))
      .toHaveAttribute('href', '/contact');

    await userEvent.click(main().getByRole('button', { name: '再試行' }));

    await expect.element(pageTitle()).toHaveTextContent('AIの作り手');
    await expect.element(pageTitle()).toHaveFocus();
    expect(main().getByRole('alert').query()).toBeNull();
  });

  test('再試行がまた失敗しても、取得の失敗の表示を保つ', async () => {
    executeGraphQL.mockResolvedValue(INTERNAL_ERROR);

    await renderProfile('/@maker_ai');
    await userEvent.click(main().getByRole('button', { name: '再試行' }));

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(ERROR_MESSAGE);
    await vi.waitFor(() => {
      expect(callsOf(ClientPublicProfileDocument).length).toBeGreaterThan(1);
    });
  });

  test('フォローすると、フォロワー数とフォローの関係を結果で更新し、同じ閲覧者の取り直しでも続ける', async () => {
    executeGraphQL.mockImplementation((document: unknown) => {
      if (document === ClientPublicProfileDocument) {
        return Promise.resolve(
          ok(profileOf({ viewerRelation: 'NOT_FOLLOWING' })),
        );
      }
      if (document === ClientFollowUserDocument) {
        return Promise.resolve(
          ok({
            followUser: {
              handle: 'maker_ai',
              following: true,
              followerCount: 13,
            },
          }),
        );
      }
      return Promise.reject(new Error('想定外の文書の取得'));
    });

    await renderProfile('/@maker_ai', { signedIn: true });
    await expect.element(main().getByText('12')).toBeVisible();
    await expect
      .element(main().getByRole('button', { name: 'フォロー' }))
      .toBeVisible();
    expect(lastTurnstileProps()).toBeDefined();

    await userEvent.click(
      page.getByRole('button', { name: '判定を成功させる' }),
    );
    await userEvent.click(main().getByRole('button', { name: 'フォロー' }));

    await expect.element(main().getByText('13')).toBeVisible();
    await expect
      .element(main().getByRole('button', { name: 'フォロー中' }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(callsOf(ClientPublicProfileDocument)).toHaveLength(1);
  });

  test('タブを選ぶと、tabのクエリを履歴へ積み、タブの内容を切り替える', async () => {
    respondByHandle({ maker_ai: profileOf() });

    const router = await renderProfile('/@maker_ai');
    await expect.element(main().getByText('ローンチの内容')).toBeVisible();
    expect(router.state.location.searchStr).not.toContain('tab=');

    await userEvent.click(main().getByRole('tab', { name: 'Upvote' }));

    await expect.element(main().getByText('Upvoteの内容')).toBeVisible();
    expect(router.state.location.search).toMatchObject({ tab: 'upvotes' });
    expect(callsOf(ClientPublicProfileDocument)).toHaveLength(1);
  });

  test('未登録のtabの値でも、既定のタブで表示する', async () => {
    respondByHandle({ maker_ai: profileOf() });

    await renderProfile('/@maker_ai?tab=unknown');

    await expect.element(main().getByText('ローンチの内容')).toBeVisible();
  });

  test('ヘッダーのユーザーメニューの「プロフィール」から、自分の公開プロフィールを開く', async () => {
    respondByHandle({
      maker_ai: profileOf(),
      [VIEWER_HANDLE]: profileOf({
        handle: VIEWER_HANDLE,
        nickname: '自分のニックネーム',
        viewerRelation: 'OWNER',
      }),
    });

    await page.viewport(WIDE_VIEWPORT_WIDTH, WIDE_VIEWPORT_HEIGHT);
    const router = await renderProfile('/@maker_ai', { signedIn: true });
    await expect.element(pageTitle()).toHaveTextContent('AIの作り手');

    await userEvent.click(
      page.getByRole('button', { name: /のユーザーメニュー$/u }),
    );
    await userEvent.click(page.getByRole('menuitem', { name: 'プロフィール' }));

    await expect.element(pageTitle()).toHaveTextContent('自分のニックネーム');
    expect(router.state.location.pathname).toBe(`/@${VIEWER_HANDLE}`);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('表示した公開プロフィールで、アクセシビリティの検査の違反が0件', async () => {
      respondByHandle({ maker_ai: profileOf() });
      await renderProfile('/@maker_ai');
      await expect.element(pageTitle()).toBeVisible();

      expect(await runAxe(document.body)).toHaveLength(0);
    });

    test('取得の失敗の画面で、アクセシビリティの検査の違反が0件', async () => {
      executeGraphQL.mockResolvedValue(INTERNAL_ERROR);
      await renderProfile('/@maker_ai');
      await expect.element(main().getByRole('alert')).toBeVisible();

      expect(await runAxe(document.body)).toHaveLength(0);
    });
  });
});
