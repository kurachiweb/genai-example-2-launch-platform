import { notifyManager } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../src/styles.css';
import { runAxe } from '../lib/test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../lib/test/computed-style.ts';
import { GraphQLClientError } from '../lib/utilities/graphql/graphql-result.ts';
import { requireViewer } from '../src/components/auth/require-viewer.ts';
import {
  CHECKOUT_RETURN_RECHECK_INTERVAL_MS,
  CHECKOUT_RETURN_RECHECK_LIMIT,
} from '../src/components/payments/checkout-return-rules.ts';
import { ClientConfirmCheckoutReturnDocument } from '../src/graphql/generated/graphql.ts';
import { Route as CheckoutReturnRoute } from '../src/routes/_authenticated/checkout/return.tsx';
import {
  CHECKOUT_PURCHASE_ID,
  type CheckoutResult,
  settledCheckout,
} from './checkout-fixtures.ts';
import { type PageRootRoute, renderPageRouter } from './page-router.tsx';
import { signedInViewerQuery } from './viewer-fixtures.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../lib/start/graphql/execute-graphql.ts', () => ({ executeGraphQL }));

const SESSION_ID = ['cs', 'test', 'return0001'].join('_');

const RETURN_PATH = `/checkout/return?session_id=${SESSION_ID}`;

const PROCESSING_TEXT =
  'お支払いを確認しています。確認が済むと、決済履歴に記録されます。';

const COMPLETED_TEXT = 'お支払いを確認し、購入が確定しました。';

const DELAYED_TEXT =
  'お支払いの確認に時間がかかっています。しばらくしてから、決済履歴でお支払いの記録をご確認ください。';

const INVALID_SESSION_TEXT = '決済の確認に必要な情報が正しくありません。';

const NOT_FOUND_TEXT = 'お探しの決済は見つかりませんでした。';

const UNAVAILABLE_TEXT =
  '現在ご利用いただけません。決済サービスで障害が発生しています。閲覧やその他の操作は引き続きご利用いただけます。';

// 偽のsetTimeoutでTanStack Queryの結果の通知が止まらないよう、通知のまとめをタイマーを使わずに届ける
const SYSTEM_NOTIFY_SCHEDULER = (callback: () => void): void => {
  setTimeout(callback, 0);
};

// アプリの経路と同じ検証・画面を通すため、本物の経路の設定を、ログイン必須のレイアウトの下の同じ位置の経路へ写す
const createRoutes = (rootRoute: PageRootRoute) => {
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_authenticated',
    beforeLoad: requireViewer,
  });
  return [
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/auth/login',
      component: () => <h1>ログイン</h1>,
    }),
    authenticatedRoute.addChildren([
      createRoute({
        getParentRoute: () => authenticatedRoute,
        path: '/checkout/return',
        validateSearch: CheckoutReturnRoute.options.validateSearch,
        component: CheckoutReturnRoute.options.component,
      } as Parameters<typeof createRoute>[0]),
      createRoute({
        getParentRoute: () => authenticatedRoute,
        path: '/settings/billing',
        component: () => <h1>決済履歴</h1>,
      }),
    ]),
  ];
};

const renderReturnRoute = (path = RETURN_PATH) =>
  renderPageRouter({
    path,
    createRoutes,
    cachedViewer: signedInViewerQuery(),
  });

const confirmResult = (checkout: CheckoutResult) => ({
  ok: true,
  data: { confirmCheckoutReturn: { checkout } },
});

// 呼ばれた順に結果を返し、尽きたら最後の結果を返し続ける
const respondInOrder = (...results: readonly unknown[]) => {
  let calls = 0;
  executeGraphQL.mockImplementation(() => {
    const result = results[Math.min(calls, results.length - 1)];
    calls += 1;
    return Promise.resolve(result);
  });
};

const respondWith = (...checkouts: readonly CheckoutResult[]) => {
  respondInOrder(...checkouts.map(confirmResult));
};

const confirmCalls = () =>
  executeGraphQL.mock.calls.filter(
    ([document]) => document === ClientConfirmCheckoutReturnDocument,
  );

const main = () => page.getByRole('main');
const pageTitle = () => main().getByRole('heading', { level: 1 });
const statusRegion = () =>
  main().getByRole('status').filter({ hasNotText: '現在ご利用いただけません' });
const billingLink = () => main().getByRole('link', { name: '決済履歴を見る' });

const processing = () => settledCheckout({ status: 'PROCESSING' });
const completed = (overrides: Partial<CheckoutResult> = {}) =>
  settledCheckout({ status: 'COMPLETED', ...overrides });

const useRecheckTimers = () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
};

beforeEach(() => {
  executeGraphQL.mockReset();
  notifyManager.setScheduler(queueMicrotask);
});

afterEach(() => {
  vi.useRealTimers();
  notifyManager.setScheduler(SYSTEM_NOTIFY_SCHEDULER);
  applyColorScheme('light');
});

describe('決済後のランディングの経路', () => {
  test('未ログインでは、決済セッションのIDを含むパスを戻り先にしたログイン画面へ移し、確認を呼ばない', async () => {
    const router = await renderPageRouter({
      path: RETURN_PATH,
      createRoutes,
    });

    await expect.element(pageTitle()).toHaveTextContent('ログイン');
    expect(router.state.location.search).toEqual({ redirect: RETURN_PATH });
    expect(executeGraphQL).not.toHaveBeenCalled();
  });

  test('完了した購入は、マウントの後に1回だけ確認し、購入の内容と決済履歴への導線を示す', async () => {
    respondWith(completed());

    await renderReturnRoute();

    await expect.element(pageTitle()).toHaveTextContent('お支払いの結果');
    await expect.element(statusRegion()).toHaveTextContent(COMPLETED_TEXT);
    const summary = main().getByRole('region', { name: '購入の内容' });
    expect(
      summary
        .getByRole('term')
        .elements()
        .map((term) => term.textContent),
    ).toEqual(['購入', '分量', 'お支払い金額(税込)', '役務の提供時期']);
    expect(
      summary
        .getByRole('definition')
        .elements()
        .map((definition) => definition.textContent),
    ).toEqual([
      'Weekトーナメントの参加費',
      '1件',
      '$12.00',
      '購入の確定後すぐに参加資格を付与します。',
    ]);
    await expect
      .element(billingLink())
      .toHaveAttribute('href', '/settings/billing');
    expect(confirmCalls()).toEqual([
      [
        ClientConfirmCheckoutReturnDocument,
        { sessionId: SESSION_ID },
        expect.anything(),
      ],
    ]);
  });

  test.each([
    ['WEEK_TOURNAMENT_ENTRY', 'プロダクト管理を見る', '/my/products'],
    ['YEAR_TOURNAMENT_ENTRY', 'プロダクト管理を見る', '/my/products'],
    ['SPONSORSHIP', 'スポンサー広告を見る', '/settings/sponsorships'],
    ['ULTRAS', 'プランを見る', '/settings/plan'],
  ] as const)(
    '完了した%sの購入は、購入した対象の画面への導線「%s」(%s)を示す',
    async (kind, label, href) => {
      respondWith(completed({ kind }));

      await renderReturnRoute();

      await expect
        .element(main().getByRole('link', { name: label }))
        .toHaveAttribute('href', href);
      await expect.element(billingLink()).toBeInTheDocument();
    },
  );

  test('完了した疎通確認の購入は、購入した対象の画面への導線を置かず、決済履歴への導線だけを示す', async () => {
    respondWith(completed({ kind: 'PAYMENTS_SMOKE' }));

    await renderReturnRoute();

    await expect.element(billingLink()).toBeInTheDocument();
    expect(
      main()
        .getByRole('link')
        .elements()
        .map((link) => link.textContent),
    ).toEqual(['決済履歴を見る']);
  });

  test('処理中の間は処理中の旨を示し、3秒ごとに確かめ直して、完了したら完了の内容を伝える', async () => {
    useRecheckTimers();
    respondWith(processing(), processing(), completed());
    await renderReturnRoute();
    await expect.element(statusRegion()).toHaveTextContent(PROCESSING_TEXT);
    await expect.element(billingLink()).toBeInTheDocument();
    expect(confirmCalls()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(CHECKOUT_RETURN_RECHECK_INTERVAL_MS - 1);
    expect(confirmCalls()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect.poll(() => confirmCalls().length).toBe(2);
    await expect.element(statusRegion()).toHaveTextContent(PROCESSING_TEXT);

    await vi.advanceTimersByTimeAsync(CHECKOUT_RETURN_RECHECK_INTERVAL_MS);

    await expect.element(statusRegion()).toHaveTextContent(COMPLETED_TEXT);
    expect(confirmCalls()).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(CHECKOUT_RETURN_RECHECK_INTERVAL_MS * 3);
    expect(confirmCalls()).toHaveLength(3);
  });

  test('20回確かめ直しても処理中なら、確かめ直しをやめて決済履歴での確認を案内する', async () => {
    useRecheckTimers();
    respondWith(processing());
    await renderReturnRoute();
    await expect.element(statusRegion()).toHaveTextContent(PROCESSING_TEXT);

    for (let recheck = 1; recheck <= CHECKOUT_RETURN_RECHECK_LIMIT; recheck++) {
      await vi.advanceTimersByTimeAsync(CHECKOUT_RETURN_RECHECK_INTERVAL_MS);
      await expect.poll(() => confirmCalls().length).toBe(recheck + 1);
    }

    await expect.element(statusRegion()).toHaveTextContent(DELAYED_TEXT);
    await expect
      .element(billingLink())
      .toHaveAttribute('href', '/settings/billing');
    await vi.advanceTimersByTimeAsync(CHECKOUT_RETURN_RECHECK_INTERVAL_MS * 3);
    expect(confirmCalls()).toHaveLength(CHECKOUT_RETURN_RECHECK_LIMIT + 1);
  });

  test('処理中に別の画面へ移ると、確かめ直しのタイマーを止める', async () => {
    useRecheckTimers();
    respondWith(processing());
    await renderReturnRoute();
    await expect.element(statusRegion()).toHaveTextContent(PROCESSING_TEXT);

    await userEvent.click(billingLink());
    await expect.element(pageTitle()).toHaveTextContent('決済履歴');

    await vi.advanceTimersByTimeAsync(CHECKOUT_RETURN_RECHECK_INTERVAL_MS * 3);
    expect(confirmCalls()).toHaveLength(1);
  });

  test('権利を付与できなかった購入は、全額を返金する旨と理由を示す', async () => {
    respondWith(
      settledCheckout({ status: 'REFUNDING', rejectionReason: 'LATE' }),
    );

    await renderReturnRoute();

    await expect
      .element(statusRegion())
      .toHaveTextContent(
        '購入を確定できなかったため、お支払いいただいた金額の全額を返金します。',
      );
    await expect
      .element(statusRegion())
      .toHaveTextContent(
        '返金の理由: お支払いの確認が、購入を反映できる期限に間に合いませんでした。',
      );
    await expect.element(billingLink()).toBeInTheDocument();
  });

  test.each([
    ['WEEK_TOURNAMENT_ENTRY', '/my/products'],
    ['SPONSORSHIP', '/pricing'],
    ['PAYMENTS_SMOKE', '/settings/billing'],
  ] as const)(
    '受付期限の前に失効した%sの購入は、未完了の旨と申込みの画面(%s)へのやり直しの導線を示す',
    async (kind, href) => {
      respondWith(
        settledCheckout({ status: 'EXPIRED', kind, canRestart: true }),
      );

      await renderReturnRoute();

      await expect
        .element(statusRegion())
        .toHaveTextContent(
          '決済の有効期限が切れたため、購入は完了していません。',
        );
      await expect
        .element(main().getByRole('link', { name: '決済をやり直す' }))
        .toHaveAttribute('href', href);
    },
  );

  test('受付期限の後に失効した購入は、やり直せない旨を示し、やり直しの導線を置かない', async () => {
    respondWith(settledCheckout({ status: 'EXPIRED', canRestart: false }));

    await renderReturnRoute();

    await expect
      .element(statusRegion())
      .toHaveTextContent('受付期限を過ぎたため、この購入はやり直せません。');
    expect(
      main().getByRole('link', { name: '決済をやり直す' }).query(),
    ).toBeNull();
  });

  test('支払いが完了せず支払える状態に戻った購入は、未完了の旨と決済画面へのやり直しの導線を示す', async () => {
    respondWith(settledCheckout({ status: 'OPEN' }));

    await renderReturnRoute();

    await expect
      .element(statusRegion())
      .toHaveTextContent(
        'お支払いが完了していないため、購入は完了していません。',
      );
    await expect
      .element(main().getByRole('link', { name: '決済をやり直す' }))
      .toHaveAttribute('href', `/checkout/${CHECKOUT_PURCHASE_ID}`);
  });

  test('Stripeに到達できず状態を確かめられないときは、決済を利用できない旨を示す', async () => {
    respondWith(settledCheckout({ status: 'UNAVAILABLE' }));

    await renderReturnRoute();

    await expect
      .element(main().getByRole('status').filter({ hasText: UNAVAILABLE_TEXT }))
      .toBeInTheDocument();
    await expect.element(billingLink()).toBeInTheDocument();
  });

  test('他人の購入か存在しない決済セッションは、状態を明かさずに見つからない旨を示す', async () => {
    respondInOrder({
      ok: false,
      error: new GraphQLClientError({
        code: 'checkout_not_found',
        message: NOT_FOUND_TEXT,
        status: 404,
      }),
    });

    await renderReturnRoute();

    await expect.element(statusRegion()).toHaveTextContent(NOT_FOUND_TEXT);
    expect(main().getByRole('alert').query()).toBeNull();
    await expect.element(billingLink()).toBeInTheDocument();
  });

  test.each([
    ['欠けている', '/checkout/return'],
    ['決済セッションの形式でない', '/checkout/return?session_id=pi_test_1'],
    ['長すぎる', `/checkout/return?session_id=cs_${'a'.repeat(253)}`],
  ])(
    '決済セッションのIDが%sときは、確認を呼ばずに情報が正しくない旨を示す',
    async (_label, path) => {
      await renderReturnRoute(path);

      await expect
        .element(statusRegion())
        .toHaveTextContent(INVALID_SESSION_TEXT);
      await expect.element(billingLink()).toBeInTheDocument();
      expect(executeGraphQL).not.toHaveBeenCalled();
    },
  );

  test('APIサーバーが決済セッションのIDの形式を拒否したときは、情報が正しくない旨を示す', async () => {
    respondInOrder({
      ok: false,
      error: new GraphQLClientError({
        code: 'validation_error',
        message: '入力内容を確認してください。',
        status: 400,
        details: [
          {
            field: 'sessionId',
            code: 'invalid',
            message: INVALID_SESSION_TEXT,
          },
        ],
      }),
    });

    await renderReturnRoute();

    await expect
      .element(statusRegion())
      .toHaveTextContent(INVALID_SESSION_TEXT);
    expect(main().getByRole('alert').query()).toBeNull();
  });

  test('確認の失敗は見出しを残したまま示し、再試行で見出しへフォーカスを移して確認し直す', async () => {
    const serverError = new GraphQLClientError({
      code: 'internal_error',
      message: 'サーバーでエラーが発生しました。',
      status: 500,
    });
    respondInOrder(
      { ok: false, error: serverError },
      confirmResult(completed()),
    );

    await renderReturnRoute();

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(serverError.message);
    await expect.element(pageTitle()).toHaveTextContent('お支払いの結果');
    await userEvent.click(main().getByRole('button', { name: '再試行' }));

    await expect.element(statusRegion()).toHaveTextContent(COMPLETED_TEXT);
    await expect.element(pageTitle()).toHaveFocus();
    expect(confirmCalls()).toHaveLength(2);
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('完了の表示で、アクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    respondWith(completed({ kind: 'ULTRAS' }));
    await renderReturnRoute();
    await expect.element(statusRegion()).toHaveTextContent(COMPLETED_TEXT);

    expect(await runAxe(main().element())).toStrictEqual([]);
  });

  test('処理中の表示で、アクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    respondWith(processing());
    await renderReturnRoute();
    await expect.element(statusRegion()).toHaveTextContent(PROCESSING_TEXT);

    expect(await runAxe(main().element())).toStrictEqual([]);
  });

  test('失効した購入の表示で、アクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    respondWith(settledCheckout({ status: 'EXPIRED', canRestart: true }));
    await renderReturnRoute();
    await expect
      .element(main().getByRole('link', { name: '決済をやり直す' }))
      .toBeInTheDocument();

    expect(await runAxe(main().element())).toStrictEqual([]);
  });

  test('確認の失敗の表示で、アクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    respondInOrder({
      ok: false,
      error: new GraphQLClientError({
        code: 'internal_error',
        message: 'サーバーでエラーが発生しました。',
        status: 500,
      }),
    });
    await renderReturnRoute();
    await expect.element(main().getByRole('alert')).toBeInTheDocument();

    expect(await runAxe(main().element())).toStrictEqual([]);
  });
});
