import type { Stripe } from '@stripe/stripe-js';
import { createRoute } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../src/styles.css';
import { reportUnexpectedErrorInBrowser } from '../lib/start/observability/browser-error-reporting.ts';
import { runAxe } from '../lib/test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../lib/test/computed-style.ts';
import { GraphQLClientError } from '../lib/utilities/graphql/graphql-result.ts';
import { requireViewer } from '../src/components/auth/require-viewer.ts';
import { loadStripeOnce } from '../src/components/payments/stripe-loader.ts';
import {
  ClientCheckoutDocument,
  ClientRecordCheckoutConsentDocument,
} from '../src/graphql/generated/graphql.ts';
import { Route as CheckoutRoute } from '../src/routes/_authenticated/checkout/$purchaseId.tsx';
import {
  CHECKOUT_CLIENT_SECRET,
  CHECKOUT_PURCHASE_ID,
  type CheckoutResult,
  checkoutData,
  openCheckout,
  settledCheckout,
  ULTRAS_NOTES,
  ultrasCheckout,
} from './checkout-fixtures.ts';
import {
  fakeConfirm,
  FAKE_PAYMENT_ELEMENT_LABEL,
  lastProviderProps,
  resetFakeStripeCheckout,
  succeedFakeCheckout,
} from './fake-stripe-checkout.tsx';
import {
  createPageRouterContext,
  type PageRootRoute,
  renderPageRouter,
} from './page-router.tsx';
import { signedInViewerQuery } from './viewer-fixtures.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../lib/start/graphql/execute-graphql.ts', () => ({ executeGraphQL }));

// 部品のファイルの網羅を実物の読み込みで数えるよう、実物のまま公開の関数だけを差し替えられるようにする
vi.mock('../src/components/payments/stripe-loader.ts', { spy: true });

vi.mock(
  '@stripe/react-stripe-js/checkout',
  async () =>
    (await import('./fake-stripe-checkout.tsx')).fakeStripeCheckoutModule,
);

vi.mock('../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

const CHECKOUT_PATH = `/checkout/${CHECKOUT_PURCHASE_ID}`;

const PUBLISHABLE_KEY = ['pk', 'test', 'route'].join('_');

const FAKE_STRIPE = { label: 'fake-stripe' } as unknown as Stripe;

const UNAVAILABLE_TEXT =
  '現在ご利用いただけません。決済サービスで障害が発生しています。閲覧やその他の操作は引き続きご利用いただけます。';

const CONSENT_LABEL =
  '購入の確定後すぐに役務の提供が始まることに同意し、提供の開始により、EU・英国の消費者に認められる14日間の撤回権を失うことを了承します。(必須)';

const NOT_OPEN = new GraphQLClientError({
  code: 'checkout_not_open',
  message: 'この決済は既に完了しているか、受付が終了しています。',
  status: 409,
});

// アプリの経路と同じ取得・判定・画面を通すため、本物の経路の設定を、ログイン必須のレイアウトの下の同じ位置の経路へ写す
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
        path: '/checkout/$purchaseId',
        loader: CheckoutRoute.options.loader,
        pendingComponent: CheckoutRoute.options.pendingComponent,
        errorComponent: CheckoutRoute.options.errorComponent,
        notFoundComponent: CheckoutRoute.options.notFoundComponent,
        component: CheckoutRoute.options.component,
      } as Parameters<typeof createRoute>[0]),
    ]),
  ];
};

interface RenderOptions {
  // nullは公開キーを置いていない環境
  readonly publishableKey?: string | null;
  readonly path?: string;
}

const renderCheckoutRoute = ({
  publishableKey = PUBLISHABLE_KEY,
  path = CHECKOUT_PATH,
}: RenderOptions = {}) =>
  renderPageRouter({
    path,
    createRoutes,
    cachedViewer: signedInViewerQuery(),
    context: createPageRouterContext('local', {
      stripePublishableKey: publishableKey ?? undefined,
    }),
  });

const respondWith = (
  checkout: CheckoutResult,
  consent: () => unknown = () => ({
    ok: true,
    data: { recordCheckoutConsent: checkout },
  }),
) => {
  executeGraphQL.mockImplementation((document: unknown) =>
    Promise.resolve(
      document === ClientRecordCheckoutConsentDocument
        ? consent()
        : { ok: true, data: checkoutData(checkout) },
    ),
  );
};

const main = () => page.getByRole('main');
const pageTitle = () => main().getByRole('heading', { level: 1 });
const consentCheckbox = () =>
  main().getByRole('checkbox', { name: CONSENT_LABEL });
const payButton = () =>
  main().getByRole('button', { name: '支払いを確定する' });
const paymentElement = () =>
  main().getByRole('group', { name: FAKE_PAYMENT_ELEMENT_LABEL });
const summaryList = () =>
  main().getByRole('region', { name: '購入の内容' }).getByRole('definition');
const summaryTerms = () =>
  main().getByRole('region', { name: '購入の内容' }).getByRole('term');
const consentCalls = () =>
  executeGraphQL.mock.calls.filter(
    ([document]) => document === ClientRecordCheckoutConsentDocument,
  );

const renderOpenCheckout = async (checkout = openCheckout()) => {
  respondWith(checkout);
  const router = await renderCheckoutRoute();
  await expect.element(payButton()).toBeInTheDocument();
  return router;
};

beforeEach(() => {
  executeGraphQL.mockReset();
  vi.mocked(loadStripeOnce).mockReset();
  vi.mocked(loadStripeOnce).mockResolvedValue(FAKE_STRIPE);
  resetFakeStripeCheckout();
  succeedFakeCheckout();
  vi.mocked(reportUnexpectedErrorInBrowser).mockClear();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('決済画面の経路', () => {
  test('未ログインでは、決済画面のパスを戻り先にしたログイン画面へ移し、購入を取得しない', async () => {
    const router = await renderPageRouter({
      path: CHECKOUT_PATH,
      createRoutes,
    });

    await expect.element(pageTitle()).toHaveTextContent('ログイン');
    expect(router.state.location.search).toEqual({ redirect: CHECKOUT_PATH });
    expect(executeGraphQL).not.toHaveBeenCalled();
  });

  test('未完了の購入は、入力欄より上に分量・税込の価格・支払方法・支払時期・役務の提供時期をこの順に示す', async () => {
    await renderOpenCheckout();

    await expect.element(pageTitle()).toHaveTextContent('お支払い');
    expect(executeGraphQL).toHaveBeenCalledWith(
      ClientCheckoutDocument,
      { purchaseId: CHECKOUT_PURCHASE_ID },
      expect.anything(),
    );
    expect(
      summaryTerms()
        .elements()
        .map((term) => term.textContent),
    ).toEqual([
      '購入',
      '分量',
      '販売価格(税込)',
      '支払方法',
      '支払時期',
      '役務の提供時期',
    ]);
    expect(
      summaryList()
        .elements()
        .map((definition) => definition.textContent),
    ).toEqual([
      'Weekトーナメントの参加費',
      '1件',
      '$12.00',
      'クレジットカード・デビットカード、Apple Pay、Google Pay、Link',
      'この画面で支払いを確定した時にお支払いいただきます。',
      '購入の確定後すぐに参加資格を付与します。',
    ]);
    const summary = main()
      .getByRole('region', { name: '購入の内容' })
      .element();
    expect(
      summary.compareDocumentPosition(paymentElement().element()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      main().getByRole('heading', { name: '購入の条件' }).query(),
    ).toBeNull();
  });

  test('決済期限のある購入は、申込みの期間として受付期限の日時と残り時間を示す', async () => {
    const checkout = openCheckout();
    await renderOpenCheckout(checkout);

    const deadline = main().getByText('受付期限', { exact: false });
    await expect.element(deadline).toHaveTextContent('あと3日');
    const time = deadline.element().querySelector('time');
    expect(time?.getAttribute('datetime')).toBe(checkout.acceptUntil);
  });

  test('Ultrasプランは、自動更新・毎月の請求額・解約の方法を購入の条件として加え、支払時期に毎月の請求を示す', async () => {
    await renderOpenCheckout(ultrasCheckout());

    const conditions = main().getByRole('list', { name: '購入の条件' });
    expect(
      conditions
        .getByRole('listitem')
        .elements()
        .map((item) => item.textContent),
    ).toEqual([...ULTRAS_NOTES]);
    await expect
      .element(summaryList().nth(4))
      .toHaveTextContent(
        'この画面で支払いを確定した時に初回分をお支払いいただき、以降は毎月の更新日に自動でお支払いいただきます。',
      );
    expect(main().getByText('受付期限', { exact: false }).query()).toBeNull();
  });

  test('返金ポリシーの要旨と、アンカーの無い法的通知のページへのリンクを示す', async () => {
    await renderOpenCheckout();

    const refund = main().getByRole('region', { name: '返金ポリシー' });
    await expect
      .element(refund)
      .toHaveTextContent(
        'デジタル役務の性質上、購入の確定後の返金は原則として行いません。',
      );
    await expect
      .element(refund.getByRole('link', { name: '法的通知' }))
      .toHaveAttribute('href', '/legal');
  });

  test('同意のチェックボックスが外れている間は支払いを確定できず、チェックすると押せるようになる', async () => {
    await renderOpenCheckout();

    await expect.element(consentCheckbox()).not.toBeChecked();
    await expect.element(payButton()).toBeDisabled();

    await userEvent.click(consentCheckbox());
    await expect.element(payButton()).toBeEnabled();

    await userEvent.click(consentCheckbox());
    await expect.element(payButton()).toBeDisabled();
  });

  test('同意を記録してから支払いを確定する', async () => {
    fakeConfirm.mockReturnValue(new Promise<never>(() => undefined));
    await renderOpenCheckout();

    await userEvent.click(consentCheckbox());
    await userEvent.click(payButton());

    await expect.poll(() => fakeConfirm.mock.calls.length).toBe(1);
    expect(consentCalls()).toEqual([
      [
        ClientRecordCheckoutConsentDocument,
        { purchaseId: CHECKOUT_PURCHASE_ID },
        expect.anything(),
      ],
    ]);
    expect(lastProviderProps().options.clientSecret).toBe(
      CHECKOUT_CLIENT_SECRET,
    );
  });

  test('同意の記録が失敗したときは、理由を示して支払いを確定しない', async () => {
    respondWith(openCheckout(), () => ({ ok: false, error: NOT_OPEN }));
    await renderCheckoutRoute();
    await expect.element(payButton()).toBeInTheDocument();

    await userEvent.click(consentCheckbox());
    await userEvent.click(payButton());

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(NOT_OPEN.message);
    expect(fakeConfirm).not.toHaveBeenCalled();
    await expect.element(payButton()).toBeEnabled();
  });

  test('同意の記録が支払える状態でないことで失敗したときは、決済画面を取得し直して最新の状態を示す', async () => {
    const checkoutCalls = () =>
      executeGraphQL.mock.calls.filter(
        ([document]) => document === ClientCheckoutDocument,
      );
    let current = openCheckout();
    executeGraphQL.mockImplementation((document: unknown) => {
      if (document !== ClientRecordCheckoutConsentDocument) {
        return Promise.resolve({ ok: true, data: checkoutData(current) });
      }
      current = settledCheckout({ status: 'COMPLETED' });
      return Promise.resolve({ ok: false, error: NOT_OPEN });
    });
    await renderCheckoutRoute();
    await expect.element(payButton()).toBeInTheDocument();
    const fetchedBefore = checkoutCalls().length;

    await userEvent.click(consentCheckbox());
    await userEvent.click(payButton());

    await expect
      .element(main())
      .toHaveTextContent('この購入のお支払いは完了しています。');
    expect(checkoutCalls().length).toBe(fetchedBefore + 1);
    expect(payButton().query()).toBeNull();
    expect(fakeConfirm).not.toHaveBeenCalled();
  });

  test('同意の記録が他の理由で失敗したときは、決済画面を取得し直さない', async () => {
    respondWith(openCheckout(), () => ({
      ok: false,
      error: new GraphQLClientError({
        code: 'account_unavailable',
        message: 'このアカウントでは操作できません。',
        status: 403,
      }),
    }));
    await renderCheckoutRoute();
    await expect.element(payButton()).toBeInTheDocument();
    const fetchedBefore = executeGraphQL.mock.calls.filter(
      ([document]) => document === ClientCheckoutDocument,
    ).length;

    await userEvent.click(consentCheckbox());
    await userEvent.click(payButton());

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent('このアカウントでは操作できません。');
    expect(
      executeGraphQL.mock.calls.filter(
        ([document]) => document === ClientCheckoutDocument,
      ),
    ).toHaveLength(fetchedBefore);
  });

  test('公開キーを置いていない環境では、Stripe.jsを読み込まずに決済を利用できない旨を示し、エラートラッキングへ送らない', async () => {
    respondWith(openCheckout());

    await renderCheckoutRoute({ publishableKey: null });

    await expect
      .element(main().getByRole('status'))
      .toHaveTextContent(UNAVAILABLE_TEXT);
    expect(loadStripeOnce).not.toHaveBeenCalled();
    expect(payButton().query()).toBeNull();
    expect(consentCheckbox().query()).toBeNull();
    expect(reportUnexpectedErrorInBrowser).not.toHaveBeenCalled();
  });

  test.each<[string, CheckoutResult, readonly string[], string | undefined]>([
    [
      '完了',
      settledCheckout({ status: 'COMPLETED' }),
      ['この購入のお支払いは完了しています。'],
      '/settings/billing',
    ],
    [
      '処理中',
      settledCheckout({ status: 'PROCESSING' }),
      ['お支払いを確認しています。確認が済むと、決済履歴に記録されます。'],
      '/settings/billing',
    ],
    [
      '返金中',
      settledCheckout({ status: 'REFUNDING', rejectionReason: 'DUPLICATE' }),
      [
        '購入を確定できなかったため、お支払いいただいた金額の全額を返金します。',
        '返金の理由: 同じ購入の対象へのお支払いが既に確定していたため、重ねてのお支払いとなりました。',
      ],
      '/settings/billing',
    ],
  ])(
    '%sの購入は、入力欄を出さずに状態の案内と決済履歴への導線を示す',
    async (_label, checkout, texts, billingHref) => {
      respondWith(checkout);

      await renderCheckoutRoute();

      for (const text of texts) {
        await expect.element(main()).toHaveTextContent(text);
      }
      await expect
        .element(main().getByRole('link', { name: '決済履歴を見る' }))
        .toHaveAttribute('href', billingHref);
      expect(payButton().query()).toBeNull();
      expect(paymentElement().query()).toBeNull();
      expect(loadStripeOnce).not.toHaveBeenCalled();
    },
  );

  test.each([
    ['WEEK_TOURNAMENT_ENTRY', '/my/products'],
    ['ULTRAS', '/pricing'],
    ['PAYMENTS_SMOKE', '/settings/billing'],
  ] as const)(
    '受付期限の前に失効した%sの購入は、未完了の旨と申込みの画面(%s)へのやり直しの導線を示す',
    async (kind, href) => {
      respondWith(
        settledCheckout({ status: 'EXPIRED', kind, canRestart: true }),
      );

      await renderCheckoutRoute();

      await expect
        .element(main())
        .toHaveTextContent(
          '決済の有効期限が切れたため、購入は完了していません。',
        );
      await expect
        .element(main().getByRole('link', { name: '決済をやり直す' }))
        .toHaveAttribute('href', href);
      expect(payButton().query()).toBeNull();
    },
  );

  test('受付期限の後に失効した購入は、やり直せない旨を示し、やり直しの導線を置かない', async () => {
    respondWith(settledCheckout({ status: 'EXPIRED', canRestart: false }));

    await renderCheckoutRoute();

    await expect
      .element(main())
      .toHaveTextContent('受付期限を過ぎたため、この購入はやり直せません。');
    expect(
      main().getByRole('link', { name: '決済をやり直す' }).query(),
    ).toBeNull();
    expect(payButton().query()).toBeNull();
  });

  test('Stripeに到達できず支払いの準備ができないときは、決済を利用できない旨を示し、入力欄を出さない', async () => {
    respondWith(settledCheckout({ status: 'UNAVAILABLE' }));

    await renderCheckoutRoute();

    await expect
      .element(main().getByRole('status'))
      .toHaveTextContent(UNAVAILABLE_TEXT);
    expect(payButton().query()).toBeNull();
    expect(loadStripeOnce).not.toHaveBeenCalled();
  });

  test.each([
    [
      '他人の購入か存在しない',
      CHECKOUT_PATH,
      new GraphQLClientError({
        code: 'checkout_not_found',
        message: 'お探しの決済は見つかりませんでした。',
        status: 404,
      }),
    ],
    [
      '形式に合わない長さの購入のID',
      `/checkout/${'0'.repeat(65)}`,
      new GraphQLClientError({
        code: 'validation_error',
        message: '入力内容を確認してください。',
        status: 400,
        details: [
          {
            field: 'purchaseId',
            code: 'too_big',
            message: 'お探しの決済は見つかりませんでした。',
          },
        ],
      }),
    ],
  ])(
    '%sときは、状態を明かさずに見つからない旨を示す',
    async (_label, path, error) => {
      executeGraphQL.mockResolvedValue({ ok: false, error });

      await renderCheckoutRoute({ path });

      await expect
        .element(main())
        .toHaveTextContent('お探しの決済は見つかりませんでした。');
      await expect.element(pageTitle()).toHaveTextContent('お支払い');
      expect(main().getByRole('alert').query()).toBeNull();
      expect(payButton().query()).toBeNull();
    },
  );

  test('取得の失敗は見出しを残したまま示し、再試行で見出しへフォーカスを移して取得し直す', async () => {
    const serverError = new GraphQLClientError({
      code: 'internal_error',
      message: 'サーバーでエラーが発生しました。',
      status: 500,
    });
    executeGraphQL
      .mockResolvedValueOnce({ ok: false, error: serverError })
      .mockResolvedValue({ ok: true, data: checkoutData(openCheckout()) });

    await renderCheckoutRoute();

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(serverError.message);
    await expect.element(pageTitle()).toHaveTextContent('お支払い');
    await userEvent.click(page.getByRole('button', { name: '再試行' }));

    await expect.element(payButton()).toBeInTheDocument();
    await expect.element(pageTitle()).toHaveFocus();
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('未完了の購入の決済画面で、アクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    await renderOpenCheckout(ultrasCheckout());
    await userEvent.click(consentCheckbox());

    expect(await runAxe(main().element())).toStrictEqual([]);
  });

  test('失効した購入の表示で、アクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    respondWith(settledCheckout({ status: 'EXPIRED', canRestart: true }));
    await renderCheckoutRoute();
    await expect
      .element(main().getByRole('link', { name: '決済をやり直す' }))
      .toBeInTheDocument();

    expect(await runAxe(main().element())).toStrictEqual([]);
  });

  test('決済を利用できない表示で、アクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    respondWith(openCheckout());
    await renderCheckoutRoute({ publishableKey: null });
    await expect.element(main().getByRole('status')).toBeInTheDocument();

    expect(await runAxe(main().element())).toStrictEqual([]);
  });
});
