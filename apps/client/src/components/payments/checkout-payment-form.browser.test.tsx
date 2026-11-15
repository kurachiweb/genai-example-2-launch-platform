import type { Stripe } from '@stripe/stripe-js';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { reportUnexpectedErrorInBrowser } from '../../../lib/start/observability/browser-error-reporting.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import {
  FAKE_BILLING_ADDRESS_LABEL,
  FAKE_PAYMENT_ELEMENT_LABEL,
  failFakeCheckout,
  fakeConfirm,
  lastProviderProps,
  resetFakeStripeCheckout,
  succeedFakeCheckout,
} from '../../../test/fake-stripe-checkout.tsx';
import { CheckoutPaymentForm } from './checkout-payment-form.tsx';
import { loadStripeOnce } from './stripe-loader.ts';

// 部品のファイルの網羅を実物の読み込みで数えるよう、実物のまま公開の関数だけを差し替えられるようにする
vi.mock('./stripe-loader.ts', { spy: true });

vi.mock(
  '@stripe/react-stripe-js/checkout',
  async () =>
    (await import('../../../test/fake-stripe-checkout.tsx'))
      .fakeStripeCheckoutModule,
);

vi.mock('../../../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

const PUBLISHABLE_KEY = ['pk', 'test', 'checkout'].join('_');

const CLIENT_SECRET = ['cs', 'test', 'secret'].join('_');

const FAKE_STRIPE = { label: 'fake-stripe' } as unknown as Stripe;

const UNAVAILABLE_REASON =
  '決済サービスで障害が発生しています。閲覧やその他の操作は引き続きご利用いただけます。';

const payButton = () => page.getByRole('button', { name: '支払いを確定する' });
const busyButton = () => page.getByRole('button', { name: '送信中' });
const alert = () => page.getByRole('alert');
const unavailableNotice = () => page.getByRole('status');

interface RenderOptions {
  readonly consentGiven?: boolean;
  readonly onBeforeConfirm?: () => Promise<boolean>;
  readonly consentFailure?: string;
}

const renderForm = ({
  consentGiven = true,
  onBeforeConfirm = () => Promise.resolve(true),
  consentFailure,
}: RenderOptions = {}) =>
  render(
    <CheckoutPaymentForm
      publishableKey={PUBLISHABLE_KEY}
      clientSecret={CLIENT_SECRET}
      consentGiven={consentGiven}
      onBeforeConfirm={onBeforeConfirm}
      consentFailure={consentFailure}
    />,
  );

const renderReadyForm = async (options: RenderOptions = {}) => {
  const screen = await renderForm(options);
  await expect.element(payButton()).toBeInTheDocument();
  return screen;
};

beforeEach(() => {
  resetFakeStripeCheckout();
  vi.mocked(loadStripeOnce).mockReset();
  vi.mocked(loadStripeOnce).mockResolvedValue(FAKE_STRIPE);
  succeedFakeCheckout();
  vi.mocked(reportUnexpectedErrorInBrowser).mockClear();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('CheckoutPaymentForm', () => {
  test('公開キーでStripe.jsを読み込み、決済セッションの文脈に通貨の自動換算を許さない設定で渡して、支払い方法と請求先住所の入力欄を置く', async () => {
    await renderReadyForm();

    expect(loadStripeOnce).toHaveBeenCalledExactlyOnceWith(PUBLISHABLE_KEY);
    const { stripe, options } = lastProviderProps();
    expect(stripe).toBe(FAKE_STRIPE);
    expect(options.clientSecret).toBe(CLIENT_SECRET);
    expect(options.adaptivePricing).toStrictEqual({ allowed: false });
    await expect
      .element(page.getByRole('group', { name: FAKE_PAYMENT_ELEMENT_LABEL }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole('group', { name: FAKE_BILLING_ADDRESS_LABEL }))
      .toBeInTheDocument();
  });

  test.each([
    ['light', 'stripe'],
    ['dark', 'night'],
  ] as const)(
    '配色が%sのとき、入力欄の外観を%sの基調とsRGBに直した配色のトークンにする',
    async (scheme, theme) => {
      applyColorScheme(scheme);

      await renderReadyForm();

      const appearance =
        lastProviderProps().options.elementsOptions?.appearance;
      expect(appearance?.theme).toBe(theme);
      for (const color of [
        appearance?.variables?.colorPrimary,
        appearance?.variables?.colorBackground,
        appearance?.variables?.colorText,
        appearance?.variables?.colorDanger,
      ]) {
        expect(color).toMatch(/^rgb\(\d{1,3}, \d{1,3}, \d{1,3}\)$/);
      }
    },
  );

  test('表示中に配色を切り替えると、読み込み済みのStripeのまま入力欄の外観を切り替えた配色に組み立て直す', async () => {
    await renderReadyForm();
    const appearanceOf = () =>
      lastProviderProps().options.elementsOptions?.appearance;
    const light = appearanceOf();
    expect(light?.theme).toBe('stripe');

    applyColorScheme('dark');

    await expect.poll(() => appearanceOf()?.theme).toBe('night');
    expect(appearanceOf()?.variables?.colorText).not.toBe(
      light?.variables?.colorText,
    );
    expect(lastProviderProps().stripe).toBe(FAKE_STRIPE);
    expect(loadStripeOnce).toHaveBeenCalledOnce();
  });

  test('Stripe.jsを読み込む間は、読み込み中を示し支払うボタンを置かない', async () => {
    vi.mocked(loadStripeOnce).mockReturnValue(
      new Promise<never>(() => undefined),
    );

    await renderForm();

    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent('読み込み中');
    expect(payButton().query()).toBeNull();
  });

  test('同意が無い間と、決済セッションが確定できない間は、支払うボタンを押せない', async () => {
    const unconsented = await renderReadyForm({ consentGiven: false });
    await expect.element(payButton()).toBeDisabled();
    await unconsented.unmount();

    succeedFakeCheckout({ canConfirm: false });
    const unconfirmable = await renderReadyForm();
    await expect.element(payButton()).toBeDisabled();
    await unconfirmable.unmount();

    succeedFakeCheckout({ canConfirm: true });
    await renderReadyForm();
    await expect.element(payButton()).toBeEnabled();
  });

  test('同意の記録が失敗したときは、支払いを確定しない', async () => {
    const onBeforeConfirm = vi.fn(() => Promise.resolve(false));
    await renderReadyForm({ onBeforeConfirm });

    await userEvent.click(payButton());

    await expect.poll(() => onBeforeConfirm.mock.calls.length).toBe(1);
    await expect.element(payButton()).toBeEnabled();
    expect(fakeConfirm).not.toHaveBeenCalled();
  });

  test('同意の記録の失敗の文言を、支払うボタンの近くに示す', async () => {
    await renderReadyForm({
      consentFailure: 'この決済は既に完了しているか、受付が終了しています。',
    });

    await expect
      .element(alert())
      .toHaveTextContent(
        'この決済は既に完了しているか、受付が終了しています。',
      );
  });

  test('同意を記録した後に支払いを確定し、確定の間は送信中を示して重ねて確定しない', async () => {
    const order: string[] = [];
    const onBeforeConfirm = vi.fn(() => {
      order.push('consent');
      return Promise.resolve(true);
    });
    fakeConfirm.mockImplementation(() => {
      order.push('confirm');
      return new Promise<never>(() => undefined);
    });
    await renderReadyForm({ onBeforeConfirm });

    await userEvent.click(payButton());

    await expect.element(busyButton()).toHaveAttribute('aria-busy', 'true');
    await expect.element(busyButton()).toHaveAttribute('aria-disabled', 'true');
    await expect.element(busyButton()).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(order).toStrictEqual(['consent', 'confirm']);
    expect(fakeConfirm).toHaveBeenCalledExactlyOnceWith();
  });

  test('カードの拒否などで確定が失敗したときは、Stripeの理由を示し、エラートラッキングへ送らずにやり直せるようにする', async () => {
    fakeConfirm.mockResolvedValueOnce({
      type: 'error',
      error: {
        message: 'カードが拒否されました。',
        code: 'paymentFailed',
        paymentFailed: { declineCode: 'card_declined' },
      },
    });
    await renderReadyForm();

    await userEvent.click(payButton());

    await expect.element(alert()).toHaveTextContent('カードが拒否されました。');
    await expect.element(payButton()).toBeEnabled();
    expect(reportUnexpectedErrorInBrowser).not.toHaveBeenCalled();
  });

  test('確定の想定外の失敗は、エラートラッキングへ送り、入力欄の代わりに決済を利用できない旨を示す', async () => {
    const failure = new Error('確定の通信が途切れました');
    fakeConfirm.mockRejectedValueOnce(failure);
    await renderReadyForm();

    await userEvent.click(payButton());

    await expect
      .element(unavailableNotice())
      .toHaveTextContent(`現在ご利用いただけません。${UNAVAILABLE_REASON}`);
    expect(reportUnexpectedErrorInBrowser).toHaveBeenCalledExactlyOnceWith(
      failure,
      'render',
    );
    expect(payButton().query()).toBeNull();
  });

  test('Stripe.jsの読み込みの失敗は、エラートラッキングへ送り、決済を利用できない旨を示す', async () => {
    const failure = new Error('Stripe.jsを読み込めませんでした');
    vi.mocked(loadStripeOnce).mockRejectedValue(failure);

    await renderForm();

    await expect
      .element(unavailableNotice())
      .toHaveTextContent(UNAVAILABLE_REASON);
    expect(reportUnexpectedErrorInBrowser).toHaveBeenCalledExactlyOnceWith(
      failure,
      'render',
    );
    expect(payButton().query()).toBeNull();
  });

  test('Stripe.jsの読み込みが空の結果で終わったときも、エラートラッキングへ送り、決済を利用できない旨を示す', async () => {
    vi.mocked(loadStripeOnce).mockResolvedValue(null);

    await renderForm();

    await expect
      .element(unavailableNotice())
      .toHaveTextContent(UNAVAILABLE_REASON);
    expect(reportUnexpectedErrorInBrowser).toHaveBeenCalledExactlyOnceWith(
      expect.any(Error),
      'render',
    );
  });

  test('決済セッションの準備の失敗は、エラートラッキングへ送り、決済を利用できない旨を示す', async () => {
    failFakeCheckout('決済セッションを読み込めませんでした。');

    await renderForm();

    await expect
      .element(unavailableNotice())
      .toHaveTextContent(UNAVAILABLE_REASON);
    expect(reportUnexpectedErrorInBrowser).toHaveBeenCalledExactlyOnceWith(
      expect.any(Error),
      'render',
    );
    expect(payButton().query()).toBeNull();
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('入力欄と確定の失敗の表示で、アクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    fakeConfirm.mockResolvedValueOnce({
      type: 'error',
      error: { message: '入力内容をご確認ください。', code: null },
    });
    const { container } = await renderReadyForm();
    await userEvent.click(payButton());
    await expect.element(alert()).toBeInTheDocument();

    expect(await runAxe(container)).toStrictEqual([]);
  });
});
