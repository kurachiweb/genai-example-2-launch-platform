import { notifyManager } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../src/styles.css';
import { runAxe } from '../lib/test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../lib/test/display-emulation.ts';
import type { DisplayPreferences } from '../lib/utilities/datetime/display-preferences.ts';
import {
  errorMessageOf,
  GraphQLClientError,
} from '../lib/utilities/graphql/graphql-result.ts';
import { MyProductListPage } from '../src/components/product/my-product-list-page.tsx';
import type {
  MyProductSection,
  MyProductSectionContext,
} from '../src/components/product/product-section-types.ts';
import { BOUNDARY_REFRESH_DELAY_MS } from '../src/components/time/use-boundary-refresh.ts';
import {
  ClientMyProductsDocument,
  type ClientMyProductsQuery,
  type ClientMyProductsQueryVariables,
} from '../src/graphql/generated/graphql.ts';
import type { buildSitePageHead } from '../src/head/page-heads.ts';
import { Route as AuthenticatedRoute } from '../src/routes/_authenticated/route.tsx';
import { Route as MyProductsRoute } from '../src/routes/_authenticated/my/products/index.tsx';
import {
  createPageRouterContext,
  type PageRootRoute,
  renderPageRouter,
} from './page-router.tsx';
import { signedInViewerQuery, VIEWER_NICKNAME } from './viewer-fixtures.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../lib/start/graphql/execute-graphql.ts', () => ({ executeGraphQL }));

const TOKYO_JA: DisplayPreferences = {
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
};

const MY_PRODUCTS_PATH = '/my/products';

const PAGE_SIZE = 20;

// Vitestのブラウザモードの既定の表示領域
const DEFAULT_VIEWPORT = { width: 414, height: 896 } as const;

// 業務日付2026-11-12の0:00(UTC-08:00)
const KICKOFF_ISO = '2026-11-12T08:00:00.000Z';
const KICKOFF = new Date(KICKOFF_ISO);

const PAGE_DESCRIPTION =
  '登録したプロダクトのローンチの予定と結果を確認し、次回のローンチを予約できます。';
const EMPTY_TITLE = 'まだプロダクトはありません。';
const EMPTY_DESCRIPTION =
  'ローンチ日には予選マッチで1対1の対戦が始まります。勝利するとディレクトリに掲載されます。';
const SUSPENDED_MESSAGE =
  'このアカウントは停止されているため、プロダクトは登録・変更できません。';
const HIDDEN_BLOCK_MESSAGE =
  'このプロダクトは公開が停止されているため、ローンチを予約できません。';

type MyProductNode = ClientMyProductsQuery['myProducts']['nodes'][number];

const CATEGORY: MyProductNode['category'] = {
  id: '01JD0CATEGORY0000000000001',
  name: '開発ツール',
  handle: 'dev-tools',
  systemDefault: false,
};

const LOGO: NonNullable<MyProductNode['logo']> = {
  id: '01JD0FILE00000000000000001',
  objectKey: '0123456789abcdef'.repeat(2),
  fallbackFormat: 'PNG',
  width: 512,
  height: 512,
};

const PLAN: MyProductNode['plan'] = {
  mode: 'RESCHEDULE',
  currentLaunchDate: '2026-11-12',
  window: {
    earliest: '2026-11-11',
    latest: '2027-02-07',
    unavailable: [],
    relaunchIntervalDays: null,
  },
  blocks: [],
  locked: false,
  locks: [],
  lockUnknown: false,
  ultrasEntitled: false,
};

const SCHEDULED_LAUNCH: NonNullable<MyProductNode['latestLaunch']> = {
  id: '01JD0LAUNCH000000000000001',
  number: 1,
  launchDate: '2026-11-12',
  kickoffAt: KICKOFF_ISO,
  status: 'SCHEDULED',
  outcome: null,
  summary: { label: 'キックオフ予定', inMatch: false },
};

const PITCH: MyProductNode = {
  handle: 'pitch-notes',
  name: 'Pitch Notes',
  category: CATEGORY,
  logo: LOGO,
  hidden: false,
  listed: false,
  latestLaunch: SCHEDULED_LAUNCH,
  plan: PLAN,
};

const QUIET: MyProductNode = {
  handle: 'quiet-board',
  name: 'Quiet Board',
  category: { ...CATEGORY, id: '01JD0CATEGORY0000000000002', name: 'その他' },
  logo: null,
  hidden: true,
  listed: false,
  latestLaunch: {
    ...SCHEDULED_LAUNCH,
    id: '01JD0LAUNCH000000000000002',
    launchDate: '2026-10-01',
    kickoffAt: '2026-10-01T08:00:00.000Z',
    status: 'FINISHED',
    outcome: 'WON',
    summary: { label: '予選勝利', inMatch: false },
  },
  plan: {
    ...PLAN,
    mode: 'BLOCKED',
    currentLaunchDate: null,
    window: null,
    blocks: [
      {
        code: 'product_hidden',
        message: HIDDEN_BLOCK_MESSAGE,
        releaseAt: null,
      },
    ],
  },
};

const FRESH: MyProductNode = {
  ...PITCH,
  handle: 'fresh-idea',
  name: 'Fresh Idea',
  logo: null,
  latestLaunch: null,
  plan: { ...PLAN, mode: 'NEW', currentLaunchDate: null },
};

const LOAD_FAILURE = new GraphQLClientError({
  code: 'internal_error',
  message: 'サーバーでエラーが発生しました。',
  status: 500,
});

const productsResult = (
  nodes: readonly MyProductNode[],
  endCursor: string | null = null,
) => ({
  ok: true,
  data: {
    myProducts: {
      nodes: [...nodes],
      pageInfo: { endCursor, hasNextPage: endCursor !== null },
    },
  } satisfies ClientMyProductsQuery,
});

const productsFrom = (start: number, count: number): MyProductNode[] =>
  Array.from({ length: count }, (_, index) => ({
    ...PITCH,
    handle: `product-${(start + index).toString()}`,
    name: `プロダクト${(start + index).toString()}`,
  }));

type Responder = (variables: ClientMyProductsQueryVariables) => unknown;

const respond = (responder: Responder) => {
  executeGraphQL.mockImplementation(
    (document: unknown, variables: ClientMyProductsQueryVariables) => {
      if (document === ClientMyProductsDocument) {
        return Promise.resolve(responder(variables));
      }
      throw new Error('想定していない操作が実行されました。');
    },
  );
};

const respondWith = (nodes: readonly MyProductNode[]) => {
  respond(() => productsResult(nodes));
};

const productsCalls = () =>
  executeGraphQL.mock.calls.filter(
    ([document]) => document === ClientMyProductsDocument,
  );

const deferred = <T,>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

const sectionOf = (
  id: string,
  order: number,
  render: (product: MyProductSectionContext) => string,
): MyProductSection => ({
  id,
  order,
  component: ({ product }) => <p>{render(product)}</p>,
});

const FAILING_SECTION: MyProductSection = {
  id: 'test.failing',
  order: 20,
  component: () => {
    throw new Error('区画の描画に失敗しました。');
  },
};

const TEST_SECTIONS: readonly MyProductSection[] = [
  sectionOf(
    'test.later',
    30,
    ({ productHandle }) => `後の区画: ${productHandle}`,
  ),
  FAILING_SECTION,
  sectionOf(
    'test.first',
    10,
    ({ productHandle, productName, hidden, placement }) =>
      `先の区画: ${productHandle} ${productName} ${String(hidden)} ${placement}`,
  ),
];

// アプリの経路と同じ判定・取得・画面を通すため、本物の経路の設定を、画面のテスト用のルーターの同じ位置の経路へ写す。区画の登録を確かめる時は、本物の経路と同じ画面にテスト用の登録を渡す
const createRoutesWith =
  (sections?: readonly MyProductSection[]) => (rootRoute: PageRootRoute) => {
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
          loader: MyProductsRoute.options.loader,
          component:
            sections === undefined
              ? MyProductsRoute.options.component
              : function TestMyProductsRoute() {
                  const { viewer } = authenticatedRoute.useRouteContext();
                  return (
                    <MyProductListPage viewer={viewer} sections={sections} />
                  );
                },
        } as Parameters<typeof createRoute>[0]),
      ]),
    ];
  };

const renderMyProducts = ({
  path = MY_PRODUCTS_PATH,
  signedIn = true,
  suspended = false,
  sections,
}: {
  readonly path?: string;
  readonly signedIn?: boolean;
  readonly suspended?: boolean;
  readonly sections?: readonly MyProductSection[];
} = {}) =>
  renderPageRouter({
    path,
    createRoutes: createRoutesWith(sections),
    context: createPageRouterContext('local'),
    ...(signedIn
      ? {
          cachedViewer: signedInViewerQuery(
            suspended ? { status: 'SUSPENDED' } : {},
          ),
        }
      : {}),
  });

const main = () => page.getByRole('main');
const pageTitle = () => main().getByRole('heading', { level: 1 });
const productList = () =>
  main().getByRole('list', { name: '自分のプロダクト' });
const items = () => productList().getByRole('listitem');
const cards = () => productList().getByRole('article');
const cardOf = (name: string) => productList().getByRole('article', { name });
const loadMoreButton = () =>
  main().getByRole('button', { name: 'さらに読み込む' });
const newProductLink = () =>
  main().getByRole('link', { name: '新しいプロダクトを登録' });

type PageHead = ReturnType<typeof buildSitePageHead>;

// 偽のsetTimeoutでTanStack Queryの結果の通知が止まらないよう、テストの後に既定の通知へ戻す
const SYSTEM_NOTIFY_SCHEDULER = (callback: () => void): void => {
  setTimeout(callback, 0);
};

beforeEach(async () => {
  executeGraphQL.mockReset();
  await emulateBrowserDisplay(TOKYO_JA);
});

afterEach(async () => {
  vi.useRealTimers();
  notifyManager.setScheduler(SYSTEM_NOTIFY_SCHEDULER);
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
  await page.viewport(DEFAULT_VIEWPORT.width, DEFAULT_VIEWPORT.height);
});

describe('自分のプロダクトの経路', () => {
  test('未ログインでは、自分のプロダクトのパスを戻り先にしたログイン画面へ移し、一覧を取得しない', async () => {
    const router = await renderMyProducts({ signedIn: false });

    await expect.element(pageTitle()).toHaveTextContent('ログイン');
    expect(router.state.location.search).toEqual({
      redirect: MY_PRODUCTS_PATH,
    });
    expect(executeGraphQL).not.toHaveBeenCalled();
  });

  test('題名「自分のプロダクト」と説明文、登録画面への「新しいプロダクトを登録」を置き、最初の20件を1回だけ取得する', async () => {
    respondWith([PITCH]);

    await renderMyProducts();

    await expect.element(pageTitle()).toHaveTextContent(/^自分のプロダクト$/u);
    await expect.element(main().getByText(PAGE_DESCRIPTION)).toBeVisible();
    await expect
      .element(newProductLink())
      .toHaveAttribute('href', '/my/products/new');
    await expect.element(cards().first()).toBeVisible();
    expect(productsCalls()).toHaveLength(1);
    expect(productsCalls()[0]?.[1]).toStrictEqual({ first: PAGE_SIZE });
  });

  test('ユーザーメニューの「自身のプロダクト」から開ける', async () => {
    respondWith([PITCH]);
    // ユーザーメニューは幅の広い画面のヘッダーに置かれるため、PCの幅で開く
    await page.viewport(1280, 800);
    const router = await renderMyProducts({ path: '/' });
    await expect.element(pageTitle()).toHaveTextContent('トップページ');

    await userEvent.click(
      page.getByRole('button', {
        name: `${VIEWER_NICKNAME}のユーザーメニュー`,
      }),
    );
    await userEvent.click(
      page.getByRole('menuitem', { name: '自身のプロダクト' }),
    );

    await expect.element(pageTitle()).toHaveTextContent('自分のプロダクト');
    expect(router.state.location.pathname).toBe(MY_PRODUCTS_PATH);
    await expect.element(cardOf('Pitch Notes')).toBeVisible();
  });

  test('カードごとに、ロゴ・名称・@なしのハンドル・カテゴリ・直近のローンチの状態・次回の予約の案内・編集と詳細の導線を示す', async () => {
    respondWith([PITCH]);

    await renderMyProducts();

    const card = cardOf('Pitch Notes');
    await expect.element(card).toBeVisible();
    expect(card.element().tagName).toBe('ARTICLE');
    await expect
      .element(card.getByRole('img', { name: 'Pitch Notesのロゴ' }))
      .toBeInTheDocument();
    await expect
      .element(card.getByRole('heading', { name: 'Pitch Notes' }))
      .toBeVisible();
    await expect
      .element(card.getByText('pitch-notes', { exact: true }))
      .toBeVisible();
    expect(card.getByText('@pitch-notes').elements()).toHaveLength(0);
    await expect.element(card.getByText('開発ツール')).toBeVisible();
    await expect.element(card.getByText('キックオフ予定')).toBeVisible();
    expect(card.element().querySelector('time')?.dateTime).toBe(KICKOFF_ISO);
    await expect
      .element(card.getByText('ローンチ日は編集画面で変更できます。'))
      .toBeVisible();
    expect(card.getByText('公開停止中').elements()).toHaveLength(0);
    await expect
      .element(card.getByRole('link', { name: 'Pitch Notesを編集' }))
      .toHaveAttribute('href', '/my/products/pitch-notes/edit');
    await expect
      .element(card.getByRole('link', { name: 'Pitch Notesを編集' }))
      .toHaveTextContent('編集');
    await expect
      .element(card.getByRole('link', { name: 'Pitch Notesの詳細を見る' }))
      .toHaveAttribute('href', '/p/pitch-notes');
    await expect
      .element(card.getByRole('link', { name: 'Pitch Notesの詳細を見る' }))
      .toHaveTextContent('詳細を見る');
  });

  test.each([
    { width: 1280, direction: 'row' },
    { width: 639, direction: 'column' },
  ])(
    '幅$widthpxではカードのロゴ・情報・操作の並びを$directionにする',
    async ({ width, direction }) => {
      respondWith([PITCH]);
      await page.viewport(width, 800);

      await renderMyProducts();

      const card = cardOf('Pitch Notes');
      await expect.element(card).toBeVisible();
      expect(getComputedStyle(card.element()).flexDirection).toBe(direction);
    },
  );

  test('ロゴが無ければ名称の頭文字のプレースホルダーを示す', async () => {
    respondWith([FRESH]);

    await renderMyProducts();

    const logo = cardOf('Fresh Idea').getByRole('img', {
      name: 'Fresh Ideaのロゴ',
    });
    await expect.element(logo).toBeVisible();
    await expect
      .element(logo)
      .toHaveAttribute('data-slot', 'media-placeholder');
    await expect.element(logo).toHaveTextContent('F');
  });

  test('非公開化中のプロダクトは「公開停止中」のバッジと予約できない理由を示し、詳細の導線を出さない', async () => {
    respondWith([QUIET]);

    await renderMyProducts();

    const card = cardOf('Quiet Board');
    await expect.element(card.getByText('公開停止中')).toBeVisible();
    await expect.element(card.getByText('ディレクトリ掲載')).toBeVisible();
    await expect.element(card.getByText(HIDDEN_BLOCK_MESSAGE)).toBeVisible();
    await expect
      .element(card.getByRole('link', { name: 'Quiet Boardを編集' }))
      .toBeVisible();
    expect(
      card.getByRole('link', { name: /詳細を見る/u }).elements(),
    ).toHaveLength(0);
  });

  test('ローンチが無いプロダクトはローンチの状態を出さず、選べる最も早い日と「次回のローンチを予約」を示す', async () => {
    respondWith([FRESH]);

    await renderMyProducts();

    const card = cardOf('Fresh Idea');
    await expect
      .element(card.getByText(/以降のローンチ日を選べます。$/u))
      .toBeVisible();
    await expect
      .element(card.getByRole('link', { name: '次回のローンチを予約' }))
      .toHaveAttribute('href', '/my/products/fresh-idea/edit');
    expect(card.getByText('キックオフ予定').elements()).toHaveLength(0);
  });

  test('カードの下に登録された区画をorderの順に並べ、ハンドル・名称・非公開化中かどうか・一覧の位置を渡し、1つの区画の失敗はその位置に留める', async () => {
    respondWith([PITCH, QUIET]);

    await renderMyProducts({ sections: TEST_SECTIONS });

    const first = items().nth(0);
    await expect
      .element(first.getByText('先の区画: pitch-notes Pitch Notes false list'))
      .toBeVisible();
    await expect
      .element(first.getByText('後の区画: pitch-notes'))
      .toBeVisible();
    await expect
      .element(first.getByRole('button', { name: '再試行' }))
      .toBeVisible();
    const text = first.element().textContent;
    expect(text.indexOf('先の区画')).toBeLessThan(text.indexOf('再試行'));
    expect(text.indexOf('再試行')).toBeLessThan(text.indexOf('後の区画'));
    expect(text.indexOf('Pitch Notes')).toBeLessThan(text.indexOf('先の区画'));
    await expect
      .element(
        items().nth(1).getByText('先の区画: quiet-board Quiet Board true list'),
      )
      .toBeVisible();
    await expect.element(cardOf('Quiet Board')).toBeVisible();
  });

  test('最初は20件を読み、「さらに読み込む」で続きを後ろに加えて、加えた最初のカードへフォーカスを移す', async () => {
    respond((variables) =>
      variables.after === undefined
        ? productsResult(productsFrom(1, PAGE_SIZE), 'cursor-20')
        : productsResult(productsFrom(PAGE_SIZE + 1, 2)),
    );

    await renderMyProducts();
    await expect.poll(() => cards().elements()).toHaveLength(PAGE_SIZE);
    await userEvent.click(loadMoreButton());

    await expect.poll(() => cards().elements()).toHaveLength(PAGE_SIZE + 2);
    await expect.element(items().nth(PAGE_SIZE)).toHaveFocus();
    expect(productsCalls()[1]?.[1]).toStrictEqual({
      first: PAGE_SIZE,
      after: 'cursor-20',
    });
    expect(loadMoreButton().elements()).toHaveLength(0);
  });

  test('続きが無ければ「さらに読み込む」を置かない', async () => {
    respondWith([PITCH]);

    await renderMyProducts();

    await expect.element(cards().first()).toBeVisible();
    expect(loadMoreButton().elements()).toHaveLength(0);
  });

  test('0件なら、ローンチの予約の仕組みの説明と登録画面への導線を示す', async () => {
    respondWith([]);

    await renderMyProducts();

    await expect.element(main().getByText(EMPTY_TITLE)).toBeVisible();
    await expect.element(main().getByText(EMPTY_DESCRIPTION)).toBeVisible();
    const links = newProductLink().elements();
    expect(links).toHaveLength(2);
    expect(links.map((link) => link.getAttribute('href'))).toStrictEqual([
      '/my/products/new',
      '/my/products/new',
    ]);
  });

  test('ページの読み込みで取得できなかった一覧を表示の後に取得し直す間は、題名を残したまま一覧の位置にスケルトンを示す', async () => {
    const pending = deferred<unknown>();
    let calls = 0;
    respond(() => {
      calls += 1;
      return calls === 1 ? { ok: false, error: LOAD_FAILURE } : pending.promise;
    });

    await renderMyProducts();

    await expect.element(pageTitle()).toHaveTextContent('自分のプロダクト');
    await expect
      .element(main().getByRole('status').filter({ hasText: '読み込み中' }))
      .toBeInTheDocument();
    expect(cards().elements()).toHaveLength(0);
    pending.resolve(productsResult([PITCH]));
    await expect.element(cardOf('Pitch Notes')).toBeVisible();
  });

  test('最初の読み込みの失敗は題名を残したまま一覧の位置に再試行と問い合わせの文言で示し、再試行で題名へフォーカスを移して取得し直す', async () => {
    let failing = true;
    respond(() =>
      failing ? { ok: false, error: LOAD_FAILURE } : productsResult([PITCH]),
    );

    await renderMyProducts();

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(errorMessageOf(LOAD_FAILURE, true));
    await expect.element(pageTitle()).toHaveTextContent('自分のプロダクト');
    await expect.element(newProductLink()).toBeVisible();

    failing = false;
    await userEvent.click(main().getByRole('button', { name: '再試行' }));

    await expect.element(cardOf('Pitch Notes')).toBeVisible();
    await expect.element(pageTitle()).toHaveFocus();
    expect(main().getByRole('alert').elements()).toHaveLength(0);
  });

  test('続きの読み込みの失敗は読み込んだカードと「さらに読み込む」を残したまま近くにrole="alert"で示し、同じボタンで読み込み直せる', async () => {
    let failing = true;
    respond((variables) =>
      variables.after === undefined
        ? productsResult([PITCH], 'cursor-1')
        : failing
          ? { ok: false, error: LOAD_FAILURE }
          : productsResult([QUIET]),
    );

    await renderMyProducts();
    await userEvent.click(loadMoreButton());

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(errorMessageOf(LOAD_FAILURE, true));
    await expect.element(loadMoreButton()).toHaveFocus();
    await expect.element(cardOf('Pitch Notes')).toBeVisible();
    const alert = main().getByRole('alert').element();
    expect(alert.parentElement?.contains(loadMoreButton().element())).toBe(
      true,
    );

    failing = false;
    await userEvent.click(loadMoreButton());

    await expect.poll(() => cards().elements()).toHaveLength(2);
    expect(main().getByRole('alert').elements()).toHaveLength(0);
  });

  test('表示中にキックオフ(ローンチ日の0:00)を迎えると、その時刻に取り直してカードを「予選マッチ中」に切り替える', async () => {
    notifyManager.setScheduler(queueMicrotask);
    vi.useFakeTimers({
      now: new Date(KICKOFF.getTime() - 60_000),
      toFake: ['Date', 'setTimeout', 'clearTimeout'],
    });
    let started = false;
    respond(() =>
      productsResult([
        started
          ? {
              ...PITCH,
              latestLaunch: {
                ...SCHEDULED_LAUNCH,
                status: 'IN_PROGRESS',
                summary: { label: '予選マッチ中', inMatch: true },
              },
              plan: { ...PLAN, locked: true },
            }
          : PITCH,
      ]),
    );

    await renderMyProducts();
    const card = cardOf('Pitch Notes');
    await expect.element(card.getByText('キックオフ予定')).toBeVisible();

    started = true;
    await vi.advanceTimersByTimeAsync(60_000 + BOUNDARY_REFRESH_DELAY_MS - 1);
    expect(productsCalls()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect.element(card.getByText('予選マッチ中')).toBeVisible();
    await expect
      .element(card.getByRole('link', { name: 'トップページで見る' }))
      .toHaveAttribute('href', '/');
    expect(productsCalls()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(productsCalls()).toHaveLength(2);
  });

  test('停止中の利用者には、一覧を表示したまま停止中の案内と問い合わせの導線を示し、登録・編集の導線を無効にする', async () => {
    respondWith([FRESH, QUIET]);

    await renderMyProducts({ suspended: true });

    const notice = main().getByRole('note', { name: '停止中のアカウント' });
    await expect.element(notice).toHaveTextContent(SUSPENDED_MESSAGE);
    await expect
      .element(notice.getByRole('link', { name: 'お問い合わせ' }))
      .toHaveAttribute('href', '/contact');
    await expect
      .element(main().getByRole('button', { name: '新しいプロダクトを登録' }))
      .toBeDisabled();
    expect(newProductLink().elements()).toHaveLength(0);
    const card = cardOf('Fresh Idea');
    await expect
      .element(card.getByRole('button', { name: 'Fresh Ideaを編集' }))
      .toBeDisabled();
    expect(
      card.getByRole('link', { name: /を編集$/u }).elements(),
    ).toHaveLength(0);
    expect(
      card.getByRole('link', { name: '次回のローンチを予約' }).elements(),
    ).toHaveLength(0);
    await expect
      .element(card.getByText(/以降のローンチ日を選べます。$/u))
      .toBeVisible();
    await expect
      .element(card.getByRole('link', { name: 'Fresh Ideaの詳細を見る' }))
      .toHaveAttribute('href', '/p/fresh-idea');
    await expect
      .element(
        cardOf('Quiet Board').getByRole('button', {
          name: 'Quiet Boardを編集',
        }),
      )
      .toBeDisabled();
  });

  test('停止中の利用者の0件の表示でも、登録の導線を無効にする', async () => {
    respondWith([]);

    await renderMyProducts({ suspended: true });

    await expect.element(main().getByText(EMPTY_TITLE)).toBeVisible();
    expect(newProductLink().elements()).toHaveLength(0);
    const buttons = main()
      .getByRole('button', { name: '新しいプロダクトを登録' })
      .elements();
    expect(buttons).toHaveLength(2);
    expect(
      buttons.every((button) => (button as HTMLButtonElement).disabled),
    ).toBe(true);
  });

  test('自分のプロダクトのページのタイトルは「自分のプロダクト」で、検索エンジンに登録させない', () => {
    const head = MyProductsRoute.options.head as (() => PageHead) | undefined;
    const meta = head?.().meta ?? [];

    expect(meta).toContainEqual({ title: '自分のプロダクト | Launch Stadium' });
    expect(meta).toContainEqual({
      name: 'robots',
      content: 'noindex, nofollow',
    });
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('カードと区画と続きの読み込みの表示で、アクセシビリティの検査の違反が0件', async () => {
      respond(() => productsResult([PITCH, QUIET, FRESH], 'cursor-3'));
      await renderMyProducts({ sections: TEST_SECTIONS });
      await expect.element(loadMoreButton()).toBeVisible();
      await expect.element(cardOf('Fresh Idea')).toBeVisible();

      expect(await runAxe(main().element())).toStrictEqual([]);
    });

    test('0件の表示で、アクセシビリティの検査の違反が0件', async () => {
      respondWith([]);
      await renderMyProducts();
      await expect.element(main().getByText(EMPTY_TITLE)).toBeVisible();

      expect(await runAxe(main().element())).toStrictEqual([]);
    });

    test('最初の読み込みの失敗の表示で、アクセシビリティの検査の違反が0件', async () => {
      respond(() => ({ ok: false, error: LOAD_FAILURE }));
      await renderMyProducts();
      await expect.element(main().getByRole('alert')).toBeVisible();

      expect(await runAxe(main().element())).toStrictEqual([]);
    });

    test('続きの読み込みの失敗の表示で、アクセシビリティの検査の違反が0件', async () => {
      respond((variables) =>
        variables.after === undefined
          ? productsResult([PITCH], 'cursor-1')
          : { ok: false, error: LOAD_FAILURE },
      );
      await renderMyProducts();
      await userEvent.click(loadMoreButton());
      await expect.element(main().getByRole('alert')).toBeVisible();

      expect(await runAxe(main().element())).toStrictEqual([]);
    });

    test('停止中の利用者の表示で、アクセシビリティの検査の違反が0件', async () => {
      respondWith([FRESH, QUIET]);
      await renderMyProducts({ suspended: true });
      await expect.element(cardOf('Quiet Board')).toBeVisible();

      expect(await runAxe(main().element())).toStrictEqual([]);
    });
  });
});
