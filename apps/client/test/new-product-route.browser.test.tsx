import { createRoute } from '@tanstack/react-router';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../src/styles.css';
import { resetTurnstileScriptFailure } from '../lib/components/bot-protection/turnstile-script-failure.ts';
import { Toaster } from '../lib/components/feedback/toaster.tsx';
import { runAxe } from '../lib/test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../lib/test/display-emulation.ts';
import { resetFakeTurnstile } from '../lib/test/fake-turnstile.tsx';
import {
  stubUploadFetch,
  uploadedReply,
} from '../lib/test/fake-upload-fetch.ts';
import { createSvgFile } from '../lib/test/media-files.ts';
import { GraphQLClientError } from '../lib/utilities/graphql/graphql-result.ts';
import {
  ClientMyProductsDocument,
  ClientNewProductLaunchWindowDocument,
  type ClientNewProductLaunchWindowQuery,
  ClientProductCategoriesDocument,
  type ClientProductCategoriesQuery,
  ClientProductHandleAvailabilityDocument,
  ClientRegisterProductDocument,
  type ClientRegisterProductMutation,
  ClientResendVerificationEmailDocument,
  ClientViewerDocument,
} from '../src/graphql/generated/graphql.ts';
import type { buildSitePageHead } from '../src/head/page-heads.ts';
import { Route as AuthenticatedRoute } from '../src/routes/_authenticated/route.tsx';
import { Route as NewProductRoute } from '../src/routes/_authenticated/my/products/new.tsx';
import {
  createPageRouterContext,
  type PageRootRoute,
  renderPageRouter,
} from './page-router.tsx';
import { signedInViewerQuery } from './viewer-fixtures.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../lib/start/graphql/execute-graphql.ts', () => ({ executeGraphQL }));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../lib/test/fake-turnstile.tsx'),
);

vi.mock('../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

const NEW_PRODUCT_PATH = '/my/products/new';

// 業務日付2026-11-09の15:00(UTC-08:00)。東京では2026-11-10の8:00
const NOW = new Date('2026-11-09T23:00:00.000Z');

const UNVERIFIED_NOTICE =
  'この操作にはメールアドレスの確認が必要です。確認メールをご確認ください。';
const SUSPENDED_NOTICE =
  'このアカウントは停止されているため、プロダクトは登録・変更できません。';
const REGISTERED_MESSAGE =
  'プロダクトを登録しました。キックオフは11月20日(金) 17:00(あと10日)です。';
const LOGO_FILE_ID = '01JD0FILE0000000000000L0G0';

const CATEGORIES: ClientProductCategoriesQuery = {
  productCategories: [
    {
      id: '01JD0CATEGORY0000000000001',
      name: '開発ツール',
      handle: 'dev-tools',
      systemDefault: false,
    },
    {
      id: '01JD0CATEGORY0000000000000',
      name: 'その他',
      handle: 'other',
      systemDefault: true,
    },
  ],
};

const LAUNCH_WINDOW: ClientNewProductLaunchWindowQuery = {
  newProductLaunchWindow: {
    earliest: '2026-11-10',
    latest: '2027-02-07',
    unavailable: [
      { from: '2026-11-09', to: '2026-11-09', reason: 'PAIRING_DEADLINE' },
    ],
    relaunchIntervalDays: null,
  },
};

type RegisteredProduct = ClientRegisterProductMutation['registerProduct'];

const REGISTERED: RegisteredProduct = {
  handle: 'pitch-notes',
  previousHandle: null,
  name: 'Pitch Notes',
  tagline: 'ピッチの台本を整える',
  category: {
    id: '01JD0CATEGORY0000000000001',
    name: '開発ツール',
    handle: 'dev-tools',
    systemDefault: false,
  },
  websiteUrl: 'https://pitch.example/',
  description: '台本を整える道具です。',
  logoFileId: LOGO_FILE_ID,
  logo: null,
  screenshots: [],
  hidden: false,
  listed: false,
  version: 0,
  latestLaunch: {
    id: '01JD0LAUNCH000000000000001',
    number: 1,
    launchDate: '2026-11-20',
    kickoffAt: '2026-11-20T08:00:00.000Z',
    status: 'SCHEDULED',
    outcome: null,
    summary: { label: 'キックオフ予定', inMatch: false },
  },
  plan: {
    mode: 'RESCHEDULE',
    currentLaunchDate: '2026-11-20',
    window: null,
    blocks: [],
    locked: false,
    locks: [],
    lockUnknown: false,
    ultrasEntitled: false,
  },
};

const ok = (data: unknown) => Promise.resolve({ ok: true, data });

const failure = (error: GraphQLClientError) =>
  Promise.resolve({ ok: false, error });

interface Responders {
  readonly categories?: () => Promise<unknown>;
  readonly register?: () => Promise<unknown>;
  readonly resend?: () => Promise<unknown>;
  readonly viewer?: () => Promise<unknown>;
}

// 文脈に無い文書の取得は失敗にして、想定外の呼び出しを見逃さない
const respond = ({ categories, register, resend, viewer }: Responders = {}) => {
  executeGraphQL.mockImplementation((document: unknown) => {
    if (document === ClientProductCategoriesDocument) {
      return (categories ?? (() => ok(CATEGORIES)))();
    }
    if (document === ClientNewProductLaunchWindowDocument) {
      return ok(LAUNCH_WINDOW);
    }
    if (document === ClientProductHandleAvailabilityDocument) {
      return ok({ productHandleAvailability: 'AVAILABLE' });
    }
    if (document === ClientRegisterProductDocument) {
      return (register ?? (() => ok({ registerProduct: REGISTERED })))();
    }
    if (document === ClientResendVerificationEmailDocument) {
      return (resend ?? (() => ok({ resendVerificationEmail: 'SENT' })))();
    }
    if (document === ClientViewerDocument && viewer !== undefined) {
      return viewer();
    }
    if (document === ClientMyProductsDocument) {
      return ok({
        myProducts: {
          nodes: [],
          pageInfo: { endCursor: null, hasNextPage: false },
        },
      });
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
  return [
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: () => <h1>トップページ</h1>,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/auth/login',
      component: () => <h1>ログイン</h1>,
    }),
    authenticatedRoute.addChildren([
      createRoute({
        getParentRoute: () => authenticatedRoute,
        path: 'my/products',
        component: () => <h1>自分のプロダクトの一覧</h1>,
      }),
      createRoute({
        getParentRoute: () => authenticatedRoute,
        path: 'my/products/new',
        loader: NewProductRoute.options.loader,
        component: NewProductRoute.options.component,
      } as Parameters<typeof createRoute>[0]),
    ]),
  ];
};

async function renderNewProduct({
  path = NEW_PRODUCT_PATH,
  viewer = signedInViewerQuery(),
}: {
  readonly path?: string;
  readonly viewer?: ReturnType<typeof signedInViewerQuery> | null;
} = {}) {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  await emulateBrowserDisplay({ timeZone: 'Asia/Tokyo', locale: 'ja-JP' });
  const router = await renderPageRouter({
    path,
    createRoutes,
    context: createPageRouterContext('local'),
    ...(viewer === null ? {} : { cachedViewer: viewer }),
  });
  await render(<Toaster />);
  return router;
}

const main = () => page.getByRole('main');
const pageTitle = () => main().getByRole('heading', { level: 1 });
const form = () => main().getByRole('form', { name: 'プロダクトを登録' });
const textbox = (name: string) => form().getByRole('textbox', { name });
const registerButton = () =>
  form().getByRole('button', { name: 'ローンチを予約', exact: true });
const descriptionInput = () => textbox('説明文(必須)');

function fileInputOf(): HTMLInputElement {
  const input = form()
    .element()
    .querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) {
    throw new Error('ファイルの入力欄が描画されていません。');
  }
  return input;
}

async function fillRegistration(): Promise<void> {
  const uploads = stubUploadFetch();
  const logo = createSvgFile('logo.svg');
  await userEvent.upload(fileInputOf(), [logo]);
  await uploads.reply(uploadedReply(logo, LOGO_FILE_ID));
  await expect
    .element(form().getByRole('button', { name: /ロゴを差し替え/u }))
    .toBeEnabled();
  await userEvent.fill(textbox('名称(必須)'), ' Pitch Notes ');
  await userEvent.fill(textbox('タグライン(必須)'), 'ピッチの台本を整える');
  await userEvent.click(
    form().getByRole('combobox', { name: 'カテゴリ(必須)' }),
  );
  await userEvent.click(page.getByRole('option', { name: '開発ツール' }));
  await userEvent.fill(textbox('ハンドル(必須)'), 'pitch-notes');
  await userEvent.fill(
    textbox('外部WebサイトURL(必須)'),
    'https://pitch.example/',
  );
  await expect
    .element(
      form()
        .getByRole('toolbar', { name: '書式' })
        .getByRole('button', { name: '太字', exact: true }),
    )
    .not.toHaveAttribute('disabled');
  await userEvent.click(descriptionInput());
  await userEvent.keyboard('台本を整える道具です。');
  await userEvent.click(
    form().getByRole('button', { name: '2026年11月20日金曜日', exact: true }),
  );
  await userEvent.click(page.getByRole('button', { name: '判定を成功させる' }));
}

beforeEach(async () => {
  await page.viewport(1280, 900);
  executeGraphQL.mockReset();
  resetFakeTurnstile();
  resetTurnstileScriptFailure();
});

afterEach(async () => {
  vi.useRealTimers();
  await emulateBrowserDisplay(null);
  vi.unstubAllGlobals();
  toast.dismiss();
  applyColorScheme('light');
});

describe('プロダクトの登録画面の経路', () => {
  test('ページのタイトルは「プロダクトを登録」で、検索エンジンに登録させない', () => {
    const head = NewProductRoute.options.head as
      (() => ReturnType<typeof buildSitePageHead>) | undefined;
    const meta = head?.().meta ?? [];

    expect(meta).toContainEqual({ title: 'プロダクトを登録 | Launch Stadium' });
    expect(meta).toContainEqual({
      name: 'robots',
      content: 'noindex, nofollow',
    });
  });

  test('未ログインで開くと、登録画面を戻り先にしてログインへ移す', async () => {
    respond();
    const router = await renderNewProduct({ viewer: null });

    await expect.element(pageTitle()).toHaveTextContent('ログイン');
    expect(router.state.location.pathname).toBe('/auth/login');
    expect(router.state.location.search).toEqual({
      redirect: NEW_PRODUCT_PATH,
    });
  });

  test('ヘッダーの「ローンチする」から登録画面を開き、カテゴリと選べる日を読み込んだフォームを示す', async () => {
    respond();
    const router = await renderNewProduct({ path: '/' });

    await userEvent.click(
      page
        .getByRole('banner')
        .getByRole('link', { name: 'ローンチする', exact: true }),
    );

    await expect.element(pageTitle()).toHaveTextContent('プロダクトを登録');
    expect(router.state.location.pathname).toBe(NEW_PRODUCT_PATH);
    await expect.element(textbox('名称(必須)')).toBeEnabled();
    await expect
      .element(
        form().getByRole('button', {
          name: '2026年11月10日火曜日',
          exact: true,
        }),
      )
      .not.toHaveAttribute('aria-disabled');
    expect(main().getByRole('note').query()).toBeNull();
  });

  test('読み込みの失敗は、題名を残したまま再試行で読み込み直せる', async () => {
    let calls = 0;
    respond({
      categories: () => {
        calls += 1;
        return calls === 1
          ? failure(
              new GraphQLClientError({
                code: 'internal_error',
                message: 'サーバーでエラーが発生しました。',
                status: 500,
              }),
            )
          : ok(CATEGORIES);
      },
    });
    await renderNewProduct();

    await expect.element(pageTitle()).toHaveTextContent('プロダクトを登録');
    await expect.element(main().getByRole('alert')).toBeVisible();
    await userEvent.click(main().getByRole('button', { name: '再試行' }));

    await expect.element(textbox('名称(必須)')).toBeEnabled();
  });
});

describe('登録の送信', () => {
  test('bot対策のトークンを添えて登録し、成功するとキックオフの日時のトーストを示して自分のプロダクトへ移す', async () => {
    respond();
    const router = await renderNewProduct();
    await expect.element(textbox('名称(必須)')).toBeEnabled();

    await fillRegistration();
    await expect.element(registerButton()).toBeEnabled();
    await userEvent.click(registerButton());

    await expect.element(page.getByText(REGISTERED_MESSAGE)).toBeVisible();
    await expect
      .element(pageTitle())
      .toHaveTextContent('自分のプロダクトの一覧');
    expect(router.state.location.pathname).toBe('/my/products');
    const [, variables, options] = callsOf(
      ClientRegisterProductDocument,
    )[0] as readonly unknown[];
    expect(variables).toEqual({
      input: {
        fields: {
          name: 'Pitch Notes',
          tagline: 'ピッチの台本を整える',
          categoryId: '01JD0CATEGORY0000000000001',
          handle: 'pitch-notes',
          websiteUrl: 'https://pitch.example/',
          description: '台本を整える道具です。',
          logoFileId: LOGO_FILE_ID,
          screenshotFileIds: [],
        },
        launchDate: '2026-11-20',
      },
    });
    expect(options).toEqual({ turnstileToken: 'turnstile-token-1' });
  });

  test('選んだ日を選べなくなっていたら、その文言をローンチ日の欄に示し、選べる日を取り直す', async () => {
    const message = 'ローンチ日は11月11日〜2027年2月7日の間で選んでください。';
    respond({
      register: () =>
        failure(
          new GraphQLClientError({
            code: 'launch_date_unavailable',
            message,
            status: 422,
            details: [
              { field: 'input.launchDate', code: 'out_of_range', message },
            ],
          }),
        ),
    });
    await renderNewProduct();
    await expect.element(textbox('名称(必須)')).toBeEnabled();
    const windowCallsBefore = callsOf(
      ClientNewProductLaunchWindowDocument,
    ).length;

    await fillRegistration();
    await userEvent.click(registerButton());

    await expect.element(form().getByText(message)).toBeVisible();
    await expect
      .poll(() => callsOf(ClientNewProductLaunchWindowDocument).length)
      .toBeGreaterThan(windowCallsBefore);
    expect(form().getByRole('alert').query()).toBeNull();
  });
});

describe('メールアドレスの確認が済んでいない利用者', () => {
  test('題名の下に確認が必要な旨と再送の導線を示し、全欄と送信を無効にする', async () => {
    respond();
    await renderNewProduct({
      viewer: signedInViewerQuery({ emailVerified: false }),
    });

    await expect
      .element(main().getByRole('note', { name: 'メールアドレスの確認' }))
      .toHaveTextContent(UNVERIFIED_NOTICE);
    await expect
      .element(descriptionInput())
      .toHaveAttribute('aria-disabled', 'true');
    await expect.element(textbox('名称(必須)')).toBeDisabled();
    await expect.element(textbox('ハンドル(必須)')).toBeDisabled();
    await expect
      .element(form().getByRole('combobox', { name: 'カテゴリ(必須)' }))
      .toBeDisabled();
    await expect.element(registerButton()).toBeDisabled();
  });

  test('再送の導線から確認メールを再送し、結果をトーストで示す', async () => {
    respond();
    await renderNewProduct({
      viewer: signedInViewerQuery({ emailVerified: false }),
    });

    await userEvent.click(
      main()
        .getByRole('note', { name: 'メールアドレスの確認' })
        .getByRole('button', { name: '確認メールを再送' }),
    );

    await expect
      .element(page.getByText('確認メールを再送しました。'))
      .toBeVisible();
    expect(callsOf(ClientResendVerificationEmailDocument)).toHaveLength(1);
  });

  test('別の画面で確認を済ませた後の再送で確認済みと分かると、取り直した利用者で案内を消し全欄と送信を有効にする', async () => {
    respond({
      resend: () => ok({ resendVerificationEmail: 'ALREADY_VERIFIED' }),
      viewer: () => ok(signedInViewerQuery({ emailVerified: true })),
    });
    await renderNewProduct({
      viewer: signedInViewerQuery({ emailVerified: false }),
    });
    await expect.element(textbox('名称(必須)')).toBeDisabled();

    await userEvent.click(
      main()
        .getByRole('note', { name: 'メールアドレスの確認' })
        .getByRole('button', { name: '確認メールを再送' }),
    );

    await expect
      .element(page.getByText('メールアドレスは確認済みです。'))
      .toBeVisible();
    await expect
      .element(main().getByRole('note', { name: 'メールアドレスの確認' }))
      .not.toBeInTheDocument();
    await expect.element(textbox('名称(必須)')).toBeEnabled();
    await expect.element(registerButton()).toBeEnabled();
  });
});

describe('停止中の利用者', () => {
  test('停止中の案内を示し、全欄と送信を無効にする', async () => {
    respond();
    await renderNewProduct({
      viewer: signedInViewerQuery({ status: 'SUSPENDED' }),
    });

    await expect
      .element(main().getByRole('note', { name: '停止中のアカウント' }))
      .toHaveTextContent(SUSPENDED_NOTICE);
    await expect.element(textbox('名称(必須)')).toBeDisabled();
    await expect.element(registerButton()).toBeDisabled();
  });
});

describe('アクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '%sで、登録画面とメールアドレスの確認の案内の違反が0件である',
    async (scheme) => {
      applyColorScheme(scheme);
      respond();
      await renderNewProduct({
        viewer: signedInViewerQuery({ emailVerified: false }),
      });
      await expect
        .element(descriptionInput())
        .toHaveAttribute('aria-disabled', 'true');

      expect(await runAxe(document.body)).toEqual([]);
    },
  );

  test.each(COLOR_SCHEMES)(
    '%sで、登録画面の違反が0件である',
    async (scheme) => {
      applyColorScheme(scheme);
      respond();
      await renderNewProduct();
      await expect
        .element(
          form()
            .getByRole('toolbar', { name: '書式' })
            .getByRole('button', { name: '太字', exact: true }),
        )
        .not.toHaveAttribute('disabled');

      expect(await runAxe(document.body)).toEqual([]);
    },
  );
});
