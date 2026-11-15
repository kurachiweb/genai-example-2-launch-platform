import { createRoute } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../src/styles.css';
import { runAxe } from '../lib/test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../lib/test/display-emulation.ts';
import type { DisplayPreferences } from '../lib/utilities/datetime/display-preferences.ts';
import { GraphQLClientError } from '../lib/utilities/graphql/graphql-result.ts';
import type { AppEnvironment } from '../lib/utilities/system/system-status-availability.ts';
import {
  ClientPaymentHistoryDocument,
  type ClientPaymentHistoryQuery,
  type ClientPaymentHistoryQueryVariables,
  ClientStartSmokeCheckoutDocument,
} from '../src/graphql/generated/graphql.ts';
import type { buildSitePageHead } from '../src/head/page-heads.ts';
import { Route as AuthenticatedRoute } from '../src/routes/_authenticated/route.tsx';
import { Route as BillingSettingsRoute } from '../src/routes/_authenticated/settings/billing.tsx';
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

const BILLING_PATH = '/settings/billing';

const SMOKE_PURCHASE_ID = '01JC0SMOKEPURCHASE00000001';

const PAGE_SIZE = 20;

type PaymentRecordNode =
  ClientPaymentHistoryQuery['paymentHistory']['nodes'][number];

const PAYMENT: PaymentRecordNode = {
  id: '01JC0PAYREC00000000000003',
  kind: 'ONE_TIME',
  purpose: 'WEEK_TOURNAMENT_ENTRY',
  amount: { amount: 1200, currency: 'usd' },
  quantity: 1,
  status: 'SUCCEEDED',
  occurredAt: '2026-11-04T01:00:00.000Z',
};

const REFUND: PaymentRecordNode = {
  id: '01JC0PAYREC00000000000002',
  kind: 'REFUND',
  purpose: 'WEEK_TOURNAMENT_ENTRY',
  amount: { amount: -1200, currency: 'usd' },
  quantity: null,
  status: 'PENDING',
  occurredAt: '2026-11-05T02:30:00.000Z',
};

const SUBSCRIPTION: PaymentRecordNode = {
  id: '01JC0PAYREC00000000000001',
  kind: 'SUBSCRIPTION',
  purpose: 'ULTRAS',
  amount: { amount: 900, currency: 'usd' },
  quantity: 1,
  status: 'FAILED',
  occurredAt: '2026-10-01T00:00:00.000Z',
};

const DISPUTE: PaymentRecordNode = {
  id: '01JC0PAYREC00000000000000',
  kind: 'DISPUTE',
  purpose: 'SPONSORSHIP',
  amount: { amount: -3000, currency: 'usd' },
  quantity: null,
  status: 'DISPUTE_LOST',
  occurredAt: '2026-09-01T00:00:00.000Z',
};

const LOAD_FAILURE = new GraphQLClientError({
  code: 'internal_error',
  message: 'サーバーでエラーが発生しました。',
  status: 500,
});

const SMOKE_UNAVAILABLE = new GraphQLClientError({
  code: 'purchase_kind_unavailable',
  message: 'この購入は現在受け付けていません。',
  status: 409,
});

const historyResult = (
  nodes: readonly PaymentRecordNode[],
  endCursor: string | null = null,
) => ({
  ok: true,
  data: {
    paymentHistory: {
      nodes: [...nodes],
      pageInfo: { endCursor, hasNextPage: endCursor !== null },
    },
  } satisfies ClientPaymentHistoryQuery,
});

const recordsFrom = (start: number, count: number): PaymentRecordNode[] =>
  Array.from({ length: count }, (_, index) => ({
    ...PAYMENT,
    id: `01JC0PAYREC${String(start + index).padStart(15, '0')}`,
  }));

type HistoryResponder = (
  variables: ClientPaymentHistoryQueryVariables,
) => Promise<unknown>;

const respond = (
  history: HistoryResponder,
  smoke: () => Promise<unknown> = () =>
    Promise.resolve({
      ok: true,
      data: { startSmokeCheckout: { purchaseId: SMOKE_PURCHASE_ID } },
    }),
) => {
  executeGraphQL.mockImplementation(
    (document: unknown, variables: ClientPaymentHistoryQueryVariables) => {
      if (document === ClientPaymentHistoryDocument) {
        return history(variables);
      }
      if (document === ClientStartSmokeCheckoutDocument) {
        return smoke();
      }
      throw new Error('想定していない操作が実行されました。');
    },
  );
};

const respondWithHistory = (nodes: readonly PaymentRecordNode[]) => {
  respond(() => Promise.resolve(historyResult(nodes)));
};

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
    authenticatedRoute.addChildren([
      settingsRoute.addChildren([
        createRoute({
          getParentRoute: () => settingsRoute,
          path: 'billing',
          loader: BillingSettingsRoute.options.loader,
          component: BillingSettingsRoute.options.component,
        } as Parameters<typeof createRoute>[0]),
      ]),
      createRoute({
        getParentRoute: () => authenticatedRoute,
        path: '/checkout/$purchaseId',
        component: () => <h1>お支払い</h1>,
      }),
    ]),
  ];
};

const renderBilling = ({
  environment = 'local',
  signedIn = true,
}: {
  readonly environment?: AppEnvironment;
  readonly signedIn?: boolean;
} = {}) =>
  renderPageRouter({
    path: BILLING_PATH,
    createRoutes,
    context: createPageRouterContext(environment),
    ...(signedIn ? { cachedViewer: signedInViewerQuery() } : {}),
  });

const main = () => page.getByRole('main');
const pageTitle = () => main().getByRole('heading', { level: 1 });
const historyList = () => main().getByRole('list', { name: '決済履歴' });
const records = () => historyList().getByRole('listitem');
const loadMoreButton = () => main().getByRole('button', { name: 'さらに表示' });
const smokeButton = () =>
  main().getByRole('button', { name: '疎通確認の決済を始める' });
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

describe('決済履歴の経路', () => {
  test('未ログインでは、決済履歴のパスを戻り先にしたログイン画面へ移し、決済履歴を取得しない', async () => {
    const router = await renderBilling({ signedIn: false });

    await expect.element(pageTitle()).toHaveTextContent('ログイン');
    expect(router.state.location.search).toEqual({ redirect: BILLING_PATH });
    expect(executeGraphQL).not.toHaveBeenCalledWith(
      ClientPaymentHistoryDocument,
      expect.anything(),
      expect.anything(),
    );
  });

  test('設定のナビゲーションの中に描き、「決済履歴」を現在の項目として示す', async () => {
    respondWithHistory([PAYMENT]);

    await renderBilling();

    await expect.element(pageTitle()).toHaveTextContent('決済履歴');
    await expect
      .element(settingsNavigation().getByRole('link', { name: '決済履歴' }))
      .toHaveAttribute('aria-current', 'page');
  });

  test('記録ごとに日時・購入種別・種類・数量・符号付きの税込の金額・状態を、応答の順に示す', async () => {
    respondWithHistory([REFUND, PAYMENT, SUBSCRIPTION, DISPUTE]);

    await renderBilling();

    await expect.element(records().nth(0)).toHaveTextContent('返金');
    const refund = records().nth(0);
    await expect.element(refund).toHaveTextContent('Weekトーナメント参加費');
    await expect.element(refund).toHaveTextContent('2026年11月5日(木) 11:30');
    await expect.element(refund).toHaveTextContent('-$12.00');
    await expect.element(refund).toHaveTextContent('処理中');
    await expect.element(refund).not.toHaveTextContent('数量');
    await expect
      .element(refund.getByText('2026年11月5日(木) 11:30'))
      .toHaveAttribute('datetime', '2026-11-05T02:30:00.000Z');

    const payment = records().nth(1);
    await expect.element(payment).toHaveTextContent('都度決済');
    await expect.element(payment).toHaveTextContent('2026年11月4日(水) 10:00');
    await expect.element(payment).toHaveTextContent('数量1');
    await expect.element(payment).toHaveTextContent('金額(税込)+$12.00');
    await expect.element(payment).toHaveTextContent('成功');

    const subscription = records().nth(2);
    await expect.element(subscription).toHaveTextContent('Ultrasプラン');
    await expect.element(subscription).toHaveTextContent('定期課金の請求');
    await expect.element(subscription).toHaveTextContent('+$9.00');
    await expect.element(subscription).toHaveTextContent('失敗');

    const dispute = records().nth(3);
    await expect.element(dispute).toHaveTextContent('スポンサー広告');
    await expect.element(dispute).toHaveTextContent('チャージバック');
    await expect.element(dispute).toHaveTextContent('-$30.00');
    await expect.element(dispute).toHaveTextContent('敗訴');
  });

  test('最初は20件を読み、「さらに表示」で続きの20件を後ろに加えて、加えた最初の記録へフォーカスを移す', async () => {
    const pending = deferred<unknown>();
    const second = recordsFrom(PAGE_SIZE, PAGE_SIZE);
    respond((variables) =>
      variables.after === undefined
        ? Promise.resolve(historyResult(recordsFrom(0, PAGE_SIZE), 'cursor-2'))
        : variables.after === 'cursor-2'
          ? pending.promise
          : Promise.resolve(historyResult(recordsFrom(PAGE_SIZE * 2, 1))),
    );

    await renderBilling();

    await expect.poll(() => records().elements()).toHaveLength(PAGE_SIZE);
    expect(executeGraphQL).toHaveBeenCalledWith(
      ClientPaymentHistoryDocument,
      { first: PAGE_SIZE },
      expect.anything(),
    );

    await userEvent.click(loadMoreButton());

    const busy = main().getByRole('button', { name: '読み込み中' });
    await expect.element(busy).toHaveAttribute('aria-busy', 'true');
    await expect.element(busy).toHaveAttribute('aria-disabled', 'true');
    await expect.element(busy).toHaveFocus();
    expect(executeGraphQL).toHaveBeenCalledWith(
      ClientPaymentHistoryDocument,
      { first: PAGE_SIZE, after: 'cursor-2' },
      expect.anything(),
    );

    pending.resolve(historyResult(second, 'cursor-3'));

    await expect.poll(() => records().elements()).toHaveLength(PAGE_SIZE * 2);
    await expect.element(records().nth(PAGE_SIZE)).toHaveFocus();
    await expect.element(loadMoreButton()).toBeVisible();
  });

  test.each([
    ['疎通確認の決済の開始のボタン', () => smokeButton()],
    [
      '設定のナビゲーションのリンク',
      () => settingsNavigation().getByRole('link', { name: '決済履歴' }),
    ],
  ])(
    '続きを待つ間に利用者が%sへフォーカスを移すと、読み込んだ後もフォーカスを奪い返さない',
    async (_name, focusTarget) => {
      const pending = deferred<unknown>();
      respond((variables) =>
        variables.after === undefined
          ? Promise.resolve(historyResult([PAYMENT], 'cursor-2'))
          : pending.promise,
      );

      await renderBilling();
      await userEvent.click(loadMoreButton());
      await expect
        .element(main().getByRole('button', { name: '読み込み中' }))
        .toHaveFocus();

      (focusTarget().element() as HTMLElement).focus();
      pending.resolve(historyResult([SUBSCRIPTION]));

      await expect.poll(() => records().elements()).toHaveLength(2);
      await expect.element(focusTarget()).toHaveFocus();
    },
  );

  test('最後のページを読み込むと「さらに表示」を消し、フォーカスを加えた最初の記録へ移す', async () => {
    respond((variables) =>
      Promise.resolve(
        variables.after === undefined
          ? historyResult([PAYMENT], 'cursor-2')
          : historyResult([SUBSCRIPTION]),
      ),
    );

    await renderBilling();
    await userEvent.click(loadMoreButton());

    await expect.poll(() => records().elements()).toHaveLength(2);
    await expect.element(records().nth(1)).toHaveFocus();
    expect(loadMoreButton().elements()).toHaveLength(0);
  });

  test('続きが無ければ「さらに表示」を置かない', async () => {
    respondWithHistory([PAYMENT]);

    await renderBilling();

    await expect.poll(() => records().elements()).toHaveLength(1);
    expect(loadMoreButton().elements()).toHaveLength(0);
  });

  test('決済履歴が0件なら、決済履歴が無い旨を示す', async () => {
    respondWithHistory([]);

    await renderBilling();

    await expect
      .element(main().getByText('決済履歴はまだありません。'))
      .toBeVisible();
    expect(historyList().elements()).toHaveLength(0);
  });

  test('最初の読み込みの失敗は見出しを残したまま示し、再試行で見出しへフォーカスを移して取得し直す', async () => {
    let failing = true;
    respond(() =>
      Promise.resolve(
        failing ? { ok: false, error: LOAD_FAILURE } : historyResult([PAYMENT]),
      ),
    );

    await renderBilling();

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(LOAD_FAILURE.message);
    await expect.element(pageTitle()).toHaveTextContent('決済履歴');

    failing = false;
    await userEvent.click(main().getByRole('button', { name: '再試行' }));

    await expect.element(records().first()).toHaveTextContent('都度決済');
    await expect.element(pageTitle()).toHaveFocus();
  });

  test('続きの読み込みの失敗は読み込んだ記録を残したまま示し、「さらに表示」で読み込み直せる', async () => {
    let failing = true;
    respond((variables) =>
      Promise.resolve(
        variables.after === undefined
          ? historyResult([PAYMENT], 'cursor-2')
          : failing
            ? { ok: false, error: LOAD_FAILURE }
            : historyResult([SUBSCRIPTION]),
      ),
    );

    await renderBilling();
    await userEvent.click(loadMoreButton());

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(LOAD_FAILURE.message);
    expect(records().elements()).toHaveLength(1);
    await expect.element(loadMoreButton()).toHaveFocus();

    failing = false;
    await userEvent.click(loadMoreButton());

    await expect.poll(() => records().elements()).toHaveLength(2);
    expect(main().getByRole('alert').elements()).toHaveLength(0);
  });

  test.each<AppEnvironment>(['local', 'staging'])(
    '%sでは、一覧の後に疎通確認の決済の開始のボタンを置き、押すと疎通確認の購入の決済画面へ移る',
    async (environment) => {
      respondWithHistory([]);

      const router = await renderBilling({ environment });
      await userEvent.click(smokeButton());

      await expect.element(pageTitle()).toHaveTextContent('お支払い');
      expect(router.state.location.pathname).toBe(
        `/checkout/${SMOKE_PURCHASE_ID}`,
      );
      expect(executeGraphQL).toHaveBeenCalledWith(
        ClientStartSmokeCheckoutDocument,
        {},
        expect.anything(),
      );
    },
  );

  test('prodでは、疎通確認の決済の開始のボタンを置かない', async () => {
    respondWithHistory([PAYMENT]);

    await renderBilling({ environment: 'prod' });

    await expect.element(records().first()).toBeVisible();
    expect(smokeButton().elements()).toHaveLength(0);
    expect(
      main().getByRole('region', { name: '決済の疎通確認' }).elements(),
    ).toHaveLength(0);
  });

  test('疎通確認の決済を始める間はボタンを処理中にし、始められなければ理由を示して決済履歴に留まる', async () => {
    const pending = deferred<unknown>();
    respond(
      () => Promise.resolve(historyResult([])),
      () => pending.promise,
    );

    const router = await renderBilling();
    await userEvent.click(smokeButton());

    const busy = main().getByRole('button', { name: '送信中' });
    await expect.element(busy).toHaveAttribute('aria-busy', 'true');
    await expect.element(busy).toHaveAttribute('aria-disabled', 'true');
    // 処理中のボタンはポインターの操作を受けないため、要素のclickで押して二重に始めないことを確かめる
    (busy.element() as HTMLElement).click();

    pending.resolve({ ok: false, error: SMOKE_UNAVAILABLE });

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(SMOKE_UNAVAILABLE.message);
    await expect.element(smokeButton()).toHaveFocus();
    expect(router.state.location.pathname).toBe(BILLING_PATH);
    expect(
      executeGraphQL.mock.calls.filter(
        ([document]) => document === ClientStartSmokeCheckoutDocument,
      ),
    ).toHaveLength(1);
  });

  test('決済履歴のページのタイトルは「決済履歴」で、検索エンジンに登録させない', () => {
    const head = BillingSettingsRoute.options.head as
      (() => PageHead) | undefined;
    const meta = head?.().meta ?? [];

    expect(meta).toContainEqual({ title: '決済履歴 | Launch Stadium' });
    expect(meta).toContainEqual({
      name: 'robots',
      content: 'noindex, nofollow',
    });
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('記録と続きの読み込みと疎通確認の区画の表示で、アクセシビリティの検査の違反が0件', async () => {
      respond(() =>
        Promise.resolve(
          historyResult([REFUND, PAYMENT, SUBSCRIPTION, DISPUTE], 'cursor-2'),
        ),
      );
      await renderBilling();
      await expect.element(loadMoreButton()).toBeVisible();
      await expect.element(smokeButton()).toBeVisible();

      expect(await runAxe(main().element())).toStrictEqual([]);
    });

    test('0件の表示で、アクセシビリティの検査の違反が0件', async () => {
      respondWithHistory([]);
      await renderBilling();
      await expect
        .element(main().getByText('決済履歴はまだありません。'))
        .toBeVisible();

      expect(await runAxe(main().element())).toStrictEqual([]);
    });

    test('読み込みの失敗の表示で、アクセシビリティの検査の違反が0件', async () => {
      respond(() => Promise.resolve({ ok: false, error: LOAD_FAILURE }));
      await renderBilling();
      await expect.element(main().getByRole('alert')).toBeVisible();

      expect(await runAxe(main().element())).toStrictEqual([]);
    });
  });
});
