import { createRoute } from '@tanstack/react-router';
import { render } from 'vitest-browser-react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../src/styles.css';
import { resetTurnstileScriptFailure } from '../lib/components/bot-protection/turnstile-script-failure.ts';
import { Toaster } from '../lib/components/feedback/toaster.tsx';
import { runAxe } from '../lib/test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../lib/test/computed-style.ts';
import { resetFakeTurnstile } from '../lib/test/fake-turnstile.tsx';
import { GraphQLClientError } from '../lib/utilities/graphql/graphql-result.ts';
import { UNEXPECTED_ERROR_MESSAGE } from '../lib/utilities/messages/state-messages.ts';
import {
  ClientHandleAvailabilityDocument,
  ClientMyProfileDocument,
  type ClientMyProfileQuery,
  ClientUpdateMyProfileDocument,
  ClientViewerDocument,
} from '../src/graphql/generated/graphql.ts';
import type { buildSitePageHead } from '../src/head/page-heads.ts';
import { Route as AuthenticatedRoute } from '../src/routes/_authenticated/route.tsx';
import { Route as ProfileSettingsRoute } from '../src/routes/_authenticated/settings/profile.tsx';
import { Route as SettingsRoute } from '../src/routes/_authenticated/settings/route.tsx';
import { loadMyProfile } from '../src/graphql/my-profile.ts';
import { publicProfileQueryOptions } from '../src/graphql/public-profile.ts';
import { toClientViewer } from '../src/graphql/viewer.ts';
import {
  createPageRouterContext,
  type PageRootRoute,
  renderPageRouter,
} from './page-router.tsx';
import {
  signedInViewerQuery,
  VIEWER_HANDLE,
  VIEWER_NICKNAME,
} from './viewer-fixtures.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../lib/start/graphql/execute-graphql.ts', () => ({ executeGraphQL }));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../lib/test/fake-turnstile.tsx'),
);

vi.mock('../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

type MyProfile = ClientMyProfileQuery['myProfile'];

const MY_PROFILE: MyProfile = {
  nickname: VIEWER_NICKNAME,
  handle: VIEWER_HANDLE,
  previousHandle: null,
  headline: 'ピッチを磨いています',
  bio: null,
  avatar: null,
  websites: [{ name: '個人サイト', url: 'https://maker.example/' }],
  suspended: false,
};

const SAVED_MESSAGE = 'プロフィールを保存しました。';
const VIEW_PUBLIC_PROFILE_LABEL = '公開プロフィールを見る';
const HANDLE_TAKEN_MESSAGE =
  'このハンドルは既に使われています。別の文字列を入力してください。';
const CONFLICT_MESSAGE =
  'プロフィールが別の画面で変更されました。最新の内容を読み込んでから保存してください。';
const INVALID_UPLOAD_MESSAGE = 'プロフィール画像をもう一度選択してください。';
const LOAD_FAILURE = new GraphQLClientError({
  code: 'internal_error',
  message: 'サーバーでエラーが発生しました。',
  status: 500,
});

const ok = (data: unknown) => Promise.resolve({ ok: true, data });

const failure = (error: GraphQLClientError) =>
  Promise.resolve({ ok: false, error });

type Responders = {
  readonly myProfile?: () => Promise<unknown>;
  readonly update?: (variables: unknown) => Promise<unknown>;
  readonly viewer?: () => Promise<unknown>;
};

// 文脈に無い文書の取得は失敗にして、想定外の呼び出しを見逃さない
const respond = ({ myProfile, update, viewer }: Responders = {}) => {
  let current: MyProfile = MY_PROFILE;
  executeGraphQL.mockImplementation((document: unknown, variables: unknown) => {
    if (document === ClientMyProfileDocument) {
      return (myProfile ?? (() => ok({ myProfile: current })))();
    }
    if (document === ClientHandleAvailabilityDocument) {
      return ok({ handleAvailability: 'AVAILABLE' });
    }
    if (document === ClientUpdateMyProfileDocument) {
      return (update ?? (() => Promise.reject(new Error('未設定'))))(
        variables,
      ).then((result) => {
        const saved = (result as { data?: { updateMyProfile?: MyProfile } })
          .data?.updateMyProfile;
        current = saved ?? current;
        return result;
      });
    }
    if (document === ClientViewerDocument) {
      return (viewer ?? (() => ok(signedInViewerQuery())))();
    }
    return Promise.reject(new Error('想定外の文書の取得'));
  });
};

const callsOf = (target: unknown) =>
  executeGraphQL.mock.calls.filter(([document]) => document === target);

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
    authenticatedRoute.addChildren([
      settingsRoute.addChildren([
        createRoute({
          getParentRoute: () => settingsRoute,
          path: 'profile',
          loader: loadMyProfile,
          component: ProfileSettingsRoute.options.component,
        }),
      ]),
    ]),
  ];
};

async function renderProfileEdit(
  context = createPageRouterContext('local'),
  viewer = signedInViewerQuery(),
) {
  const router = await renderPageRouter({
    path: '/settings/profile',
    createRoutes,
    context,
    cachedViewer: viewer,
  });
  await render(<Toaster />);
  return { router, context };
}

const main = () => page.getByRole('main');
const pageTitle = () => main().getByRole('heading', { level: 1 });
const form = () => page.getByRole('form', { name: 'プロフィールの編集' });
const nicknameInput = () =>
  form().getByRole('textbox', { name: 'ニックネーム(必須)' });
const handleInput = () =>
  form().getByRole('textbox', { name: 'ハンドル(必須)' });
const saveButton = () => form().getByRole('button', { name: '保存' });

async function saveWithHandle(handle: string): Promise<void> {
  await expect.element(handleInput()).toHaveValue(VIEWER_HANDLE);
  await userEvent.fill(handleInput(), handle);
  await userEvent.tab();
  await expect.element(saveButton()).toBeEnabled();
  await userEvent.click(page.getByRole('button', { name: '判定を成功させる' }));
  await userEvent.click(saveButton());
}

const savedProfile = (overrides: Partial<MyProfile> = {}): MyProfile => ({
  ...MY_PROFILE,
  handle: 'new_handle',
  previousHandle: VIEWER_HANDLE,
  ...overrides,
});

beforeEach(async () => {
  await page.viewport(1280, 900);
  executeGraphQL.mockReset();
  resetFakeTurnstile();
  resetTurnstileScriptFailure();
});

afterEach(() => {
  toast.dismiss();
  applyColorScheme('light');
});

describe('プロフィール編集の経路', () => {
  test('現在の内容を欄に表示し、設定のナビゲーションの「プロフィール」を現在の項目として示す', async () => {
    respond();

    await renderProfileEdit();

    await expect.element(pageTitle()).toHaveTextContent('プロフィール');
    await expect.element(nicknameInput()).toHaveValue(VIEWER_NICKNAME);
    await expect.element(handleInput()).toHaveValue(VIEWER_HANDLE);
    await expect
      .element(form().getByRole('textbox', { name: 'ヘッドライン' }))
      .toHaveValue('ピッチを磨いています');
    await expect
      .element(form().getByRole('textbox', { name: 'URL' }))
      .toHaveValue('https://maker.example/');
    await expect
      .element(
        page
          .getByRole('navigation', { name: '設定' })
          .getByRole('link', { name: 'プロフィール' }),
      )
      .toHaveAttribute('aria-current', 'page');
  });

  test('ページのタイトルは「プロフィール」で、検索エンジンに登録させない', () => {
    const head = ProfileSettingsRoute.options.head as
      (() => ReturnType<typeof buildSitePageHead>) | undefined;
    const meta = head?.().meta ?? [];

    expect(meta).toContainEqual({ title: 'プロフィール | Launch Stadium' });
    expect(meta).toContainEqual({
      name: 'robots',
      content: 'noindex, nofollow',
    });
  });

  test('取得の失敗は、題名と設定のナビゲーションを残したまま再試行で読み込み直せる', async () => {
    let calls = 0;
    respond({
      myProfile: () => {
        calls += 1;
        return calls === 1
          ? failure(LOAD_FAILURE)
          : ok({ myProfile: MY_PROFILE });
      },
    });

    await renderProfileEdit();

    await expect.element(pageTitle()).toHaveTextContent('プロフィール');
    await expect.element(page.getByRole('alert')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: '再試行' }));

    await expect.element(nicknameInput()).toHaveValue(VIEWER_NICKNAME);
  });

  test('保存は、bot対策のトークンと読み込んだ時点のハンドルを添えて送る', async () => {
    respond({
      update: () => ok({ updateMyProfile: savedProfile() }),
    });
    await renderProfileEdit();

    await saveWithHandle('new_handle');

    await expect
      .poll(() => callsOf(ClientUpdateMyProfileDocument))
      .toHaveLength(1);
    const call = callsOf(
      ClientUpdateMyProfileDocument,
    )[0] as readonly unknown[];
    const [, variables, options] = call;
    expect(variables).toEqual({
      input: {
        nickname: VIEWER_NICKNAME,
        handle: 'new_handle',
        headline: 'ピッチを磨いています',
        bio: null,
        avatarFileId: null,
        websites: [{ name: '個人サイト', url: 'https://maker.example/' }],
        expectedHandle: VIEWER_HANDLE,
      },
    });
    expect(options).toEqual({ turnstileToken: 'turnstile-token-1' });
  });

  test('保存に成功すると、トーストと公開プロフィールへの導線を示し、保存した内容でフォームを作り直す', async () => {
    respond({
      update: () => ok({ updateMyProfile: savedProfile() }),
    });
    await renderProfileEdit();

    await saveWithHandle('new_handle');

    await expect.element(page.getByText(SAVED_MESSAGE)).toBeVisible();
    await expect
      .element(page.getByRole('link', { name: VIEW_PUBLIC_PROFILE_LABEL }))
      .toHaveAttribute('href', '/@new_handle');
    await expect
      .element(
        page.getByText(`以前のハンドル@${VIEWER_HANDLE}は`, { exact: false }),
      )
      .toBeVisible();
    await expect.element(handleInput()).toHaveValue('new_handle');
  });

  test('保存に成功すると、ヘッダーのユーザーメニューの公開プロフィールへのリンクを新しいハンドルに更新する', async () => {
    respond({
      update: () => ok({ updateMyProfile: savedProfile() }),
      viewer: () => ok(signedInViewerQuery({ handle: 'new_handle' })),
    });
    await renderProfileEdit();

    await saveWithHandle('new_handle');

    await expect.poll(() => callsOf(ClientViewerDocument)).toHaveLength(1);
    await userEvent.click(
      page
        .getByRole('banner')
        .getByRole('button', { name: `${VIEWER_NICKNAME}のユーザーメニュー` }),
    );
    await expect
      .element(page.getByRole('menuitem', { name: 'プロフィール' }))
      .toHaveAttribute('href', '/@new_handle');
  });

  test('保存に成功すると、取得済みの公開プロフィールを捨てて、新しいハンドルのページを取り直させる', async () => {
    respond({
      update: () => ok({ updateMyProfile: savedProfile() }),
    });
    const context = createPageRouterContext('local');
    const viewer = signedInViewerQuery();
    const publicProfileKey = publicProfileQueryOptions(
      toClientViewer(viewer),
      'new_handle',
    ).queryKey;
    context.queryClient.setQueryData(publicProfileKey, { publicProfile: null });
    await renderProfileEdit(context, viewer);

    await saveWithHandle('new_handle');
    await expect.element(page.getByText(SAVED_MESSAGE)).toBeVisible();

    expect(context.queryClient.getQueryData(publicProfileKey)).toBeUndefined();
  });

  test('ハンドルが使用中のときは、ハンドルの欄に理由を示し、保存の成功の表示を出さない', async () => {
    respond({
      update: () =>
        failure(
          new GraphQLClientError({
            code: 'handle_unavailable',
            message: HANDLE_TAKEN_MESSAGE,
            status: 409,
            details: [
              {
                field: 'input.handle',
                code: 'unavailable',
                message: HANDLE_TAKEN_MESSAGE,
              },
            ],
          }),
        ),
    });
    await renderProfileEdit();

    await saveWithHandle('taken_name');

    await expect
      .element(handleInput())
      .toHaveAccessibleDescription(HANDLE_TAKEN_MESSAGE);
    expect(page.getByText(SAVED_MESSAGE).query()).toBeNull();
    expect(
      page.getByRole('link', { name: VIEW_PUBLIC_PROFILE_LABEL }).query(),
    ).toBeNull();
  });

  test('欄ごとの詳細は該当の欄に示す', async () => {
    const message = 'ニックネームは25文字以内で入力してください。';
    respond({
      update: () =>
        failure(
          new GraphQLClientError({
            code: 'validation_error',
            message: '入力内容に誤りがあります。',
            status: 422,
            details: [{ field: 'input.nickname', code: 'too_long', message }],
          }),
        ),
    });
    await renderProfileEdit();

    await saveWithHandle('new_handle');

    await expect.element(nicknameInput()).toHaveAccessibleDescription(message);
  });

  test('別の画面での保存による競合は、サーバーの文言をフォームの近くに示し、フォームの入力を残す', async () => {
    respond({
      update: () =>
        failure(
          new GraphQLClientError({
            code: 'profile_update_conflict',
            message: CONFLICT_MESSAGE,
            status: 409,
          }),
        ),
    });
    await renderProfileEdit();

    await saveWithHandle('new_handle');

    await expect
      .element(form().getByRole('alert'))
      .toHaveTextContent(CONFLICT_MESSAGE);
    await expect.element(handleInput()).toHaveValue('new_handle');
    expect(page.getByText(SAVED_MESSAGE).query()).toBeNull();
  });

  test('画像が本人のアップロード済みでないときは、サーバーの文言を示す', async () => {
    respond({
      update: () =>
        failure(
          new GraphQLClientError({
            code: 'invalid_upload',
            message: INVALID_UPLOAD_MESSAGE,
            status: 422,
          }),
        ),
    });
    await renderProfileEdit();

    await saveWithHandle('new_handle');

    await expect
      .element(form().getByRole('alert'))
      .toHaveTextContent(INVALID_UPLOAD_MESSAGE);
  });

  test('想定外の失敗は、内部の詳細を出さずに固定の文言を示す', async () => {
    respond({ update: () => Promise.reject(new TypeError('内部の詳細')) });
    await renderProfileEdit();

    await saveWithHandle('new_handle');

    await expect
      .element(form().getByRole('alert'))
      .toHaveTextContent(UNEXPECTED_ERROR_MESSAGE);
    expect(form().element().textContent).not.toContain('内部の詳細');
  });

  test('停止中の利用者には、全欄と保存を無効にして変更できない旨を示す', async () => {
    respond({
      myProfile: () => ok({ myProfile: { ...MY_PROFILE, suspended: true } }),
    });

    await renderProfileEdit(
      createPageRouterContext('local'),
      signedInViewerQuery({ status: 'SUSPENDED' }),
    );

    await expect.element(nicknameInput()).toBeDisabled();
    await expect.element(saveButton()).toBeDisabled();
    await expect
      .element(page.getByRole('note', { name: '停止中のアカウント' }))
      .toBeVisible();
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('アクセシビリティの検査の違反が0件', async () => {
      respond();
      await renderProfileEdit();
      await expect.element(nicknameInput()).toBeVisible();

      expect(await runAxe(main().element())).toStrictEqual([]);
    });
  });
});
