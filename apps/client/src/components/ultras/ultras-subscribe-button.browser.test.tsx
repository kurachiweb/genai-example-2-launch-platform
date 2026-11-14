import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import {
  GUEST_VIEWER_QUERY,
  renderInRouter,
} from '../../../test/page-router.tsx';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import {
  ClientStartUltrasCheckoutDocument,
  type ClientViewerQuery,
} from '../../graphql/generated/graphql.ts';
import { toClientViewer } from '../../graphql/viewer.ts';
import { ULTRAS_PRICE_UNAVAILABLE_MESSAGE } from './ultras-messages.ts';
import { UltrasSubscribeButton } from './ultras-subscribe-button.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const PURCHASE_ID = '01JC0ULTRASPURCHASE0000001';

const PRICE_REASON_ID = 'ultras-price-unavailable';

const SUBSCRIBE_LABEL = 'Ultrasに加入';

const PENDING_LABEL = '送信中';

const LOGIN_REQUIRED_TITLE = 'Ultrasへの加入にはログインが必要です';

const LOGIN_REQUIRED_DESCRIPTION =
  'ログインまたは登録すると、Ultrasに加入できます。';

const EMAIL_UNVERIFIED_REASON =
  'この操作にはメールアドレスの確認が必要です。確認メールをご確認ください。';

const VERIFIED_VIEWER = signedInViewerQuery();

const UNVERIFIED_VIEWER = signedInViewerQuery({ emailVerified: false });

// APIサーバーが文言規則の文言を返す契約のため、ブラウザテストではコードごとの失敗の結果をそのまま返させる
const FAILURES: readonly (readonly [string, number, string])[] = [
  ['ultras_unavailable', 422, '現在、Ultrasの新規の加入を受け付けていません。'],
  ['ultras_already_subscribed', 422, '既にUltrasに加入しています。'],
  [
    'ultras_resume_in_portal',
    422,
    '解約済みのUltrasは課金期間の末日まで有効です。継続するには「解約・支払い方法の管理」から解約を取り消してください。',
  ],
  ['email_not_verified', 403, EMAIL_UNVERIFIED_REASON],
  [
    'account_unavailable',
    403,
    'このアカウントは現在ご利用いただけません。詳しくはお問い合わせください。',
  ],
  [
    'rate_limit_exceeded',
    429,
    '操作が集中しています。しばらく待ってから再度お試しください。',
  ],
  [
    'payments_unavailable',
    503,
    '現在、決済をご利用いただけません。決済サービスで障害が発生しています。閲覧やその他の操作は引き続きご利用いただけます。',
  ],
];

interface RenderOptions {
  readonly viewerQuery?: ClientViewerQuery;
  readonly priceAvailable?: boolean;
  readonly returnTo?: string;
}

const renderButton = ({
  viewerQuery = GUEST_VIEWER_QUERY,
  priceAvailable = true,
  returnTo,
}: RenderOptions = {}) =>
  renderInRouter(
    <div>
      {priceAvailable ? null : (
        <p id={PRICE_REASON_ID}>{ULTRAS_PRICE_UNAVAILABLE_MESSAGE}</p>
      )}
      <UltrasSubscribeButton
        viewer={toClientViewer(viewerQuery)}
        priceAvailable={priceAvailable}
        priceUnavailableReasonId={PRICE_REASON_ID}
        returnTo={returnTo}
      />
    </div>,
    { cachedViewer: viewerQuery },
  );

const deferred = <T,>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

const respondWithPurchase = () => {
  executeGraphQL.mockResolvedValue({
    ok: true,
    data: { startUltrasCheckout: { purchaseId: PURCHASE_ID } },
  });
};

const respondWithFailure = (code: string, status: number, message: string) => {
  executeGraphQL.mockResolvedValue({
    ok: false,
    error: new GraphQLClientError({ code, message, status }),
  });
};

const subscribeButton = () =>
  page.getByRole('button', { name: SUBSCRIBE_LABEL });
const pendingButton = () => page.getByRole('button', { name: PENDING_LABEL });
const dialog = () => page.getByRole('dialog', { name: LOGIN_REQUIRED_TITLE });
const alert = () => page.getByRole('alert');

// 送信中のaria-disabledのボタンはポインターの操作を受けないがTabの停止位置に残りEnterも止めないため、キーボードで押して処理側が無視することを確かめる
const pressByKeyboard = async (button: ReturnType<typeof subscribeButton>) => {
  (button.element() as HTMLElement).focus();
  await userEvent.keyboard('{Enter}');
};

beforeEach(() => {
  executeGraphQL.mockReset();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('UltrasSubscribeButton', () => {
  describe('未ログインの閲覧者', () => {
    test('ボタンは押せる状態で、押すと加入を始めずにログインが必要な旨のダイアログを開く', async () => {
      await renderButton();

      await expect.element(subscribeButton()).toBeEnabled();
      await userEvent.click(subscribeButton());

      await expect.element(dialog()).toBeVisible();
      await expect
        .element(dialog())
        .toHaveAccessibleDescription(LOGIN_REQUIRED_DESCRIPTION);
      expect(executeGraphQL).not.toHaveBeenCalled();
    });

    test('ダイアログのログインの導線は料金ページを戻り先にし、登録の導線も示す', async () => {
      await renderButton();
      await userEvent.click(subscribeButton());

      await expect
        .element(dialog().getByRole('link', { name: 'ログイン', exact: true }))
        .toHaveAttribute('href', '/auth/login?redirect=%2Fpricing');
      await expect
        .element(dialog().getByRole('link', { name: '登録', exact: true }))
        .toHaveAttribute('href', '/auth/register');
    });

    test('戻り先を渡すと、ログインの導線はその戻り先を使う', async () => {
      await renderButton({ returnTo: '/settings/plan' });
      await userEvent.click(subscribeButton());

      await expect
        .element(dialog().getByRole('link', { name: 'ログイン', exact: true }))
        .toHaveAttribute('href', '/auth/login?redirect=%2Fsettings%2Fplan');
    });

    test('価格を照会できないときは、ボタンを無効にし、ダイアログを開かない', async () => {
      await renderButton({ priceAvailable: false });

      await expect.element(subscribeButton()).toBeDisabled();
      await expect
        .element(subscribeButton())
        .toHaveAccessibleDescription(ULTRAS_PRICE_UNAVAILABLE_MESSAGE);
      await expect.element(dialog()).not.toBeInTheDocument();
      expect(executeGraphQL).not.toHaveBeenCalled();
    });
  });

  describe('メールアドレスが未確認の利用者', () => {
    test('ボタンを無効にし、見える理由の文を結び付けて、加入を始めない', async () => {
      await renderButton({ viewerQuery: UNVERIFIED_VIEWER });

      await expect.element(subscribeButton()).toBeDisabled();
      await expect
        .element(subscribeButton())
        .toHaveAccessibleDescription(EMAIL_UNVERIFIED_REASON);
      await expect
        .element(page.getByText(EMAIL_UNVERIFIED_REASON))
        .toBeVisible();
      expect(executeGraphQL).not.toHaveBeenCalled();
      await expect.element(dialog()).not.toBeInTheDocument();
    });
  });

  describe('ログイン中で確認済みの利用者', () => {
    test('価格を照会できないときは、ボタンを無効にし、価格の位置の文言を理由として結び付けて、加入を始めない', async () => {
      await renderButton({
        viewerQuery: VERIFIED_VIEWER,
        priceAvailable: false,
      });

      await expect.element(subscribeButton()).toBeDisabled();
      await expect
        .element(subscribeButton())
        .toHaveAccessibleDescription(ULTRAS_PRICE_UNAVAILABLE_MESSAGE);
      expect(executeGraphQL).not.toHaveBeenCalled();
    });

    test('価格があれば、ボタンは押せる状態で理由を結び付けない', async () => {
      await renderButton({ viewerQuery: VERIFIED_VIEWER });

      await expect.element(subscribeButton()).toBeEnabled();
      await expect
        .element(subscribeButton())
        .not.toHaveAttribute('aria-disabled');
      await expect
        .element(subscribeButton())
        .not.toHaveAttribute('aria-describedby');
    });

    test('押すとUltrasの購入を作り、その購入の決済画面へ移る', async () => {
      respondWithPurchase();

      const router = await renderButton({ viewerQuery: VERIFIED_VIEWER });
      await userEvent.click(subscribeButton());

      await expect
        .poll(() => router.state.location.pathname)
        .toBe(`/checkout/${PURCHASE_ID}`);
      expect(executeGraphQL).toHaveBeenCalledTimes(1);
      expect(executeGraphQL).toHaveBeenCalledWith(
        ClientStartUltrasCheckoutDocument,
        {},
        expect.anything(),
      );
    });

    test('送信中はボタンを処理中にして「送信中」と示し、重ねて押しても送信しない', async () => {
      const pending = deferred<unknown>();
      executeGraphQL.mockReturnValue(pending.promise);

      const router = await renderButton({ viewerQuery: VERIFIED_VIEWER });
      await userEvent.click(subscribeButton());

      await expect
        .element(pendingButton())
        .toHaveAttribute('aria-busy', 'true');
      await expect
        .element(pendingButton())
        .toHaveAttribute('aria-disabled', 'true');
      await pressByKeyboard(pendingButton());
      expect(executeGraphQL).toHaveBeenCalledTimes(1);

      pending.resolve({
        ok: true,
        data: { startUltrasCheckout: { purchaseId: PURCHASE_ID } },
      });
      await expect
        .poll(() => router.state.location.pathname)
        .toBe(`/checkout/${PURCHASE_ID}`);
    });

    test.each(FAILURES)(
      '加入の開始が%sで失敗すると、サーバーの文言をボタンの近くに警告として示し、ボタンへ結び付けて押し直せる状態に戻す',
      async (code, status, message) => {
        respondWithFailure(code, status, message);

        const router = await renderButton({ viewerQuery: VERIFIED_VIEWER });
        await userEvent.click(subscribeButton());

        await expect.element(alert()).toHaveTextContent(message);
        await expect
          .element(subscribeButton())
          .toHaveAccessibleDescription(message);
        await expect.element(subscribeButton()).toBeEnabled();
        await expect
          .element(subscribeButton())
          .not.toHaveAttribute('aria-disabled');
        expect(router.state.location.pathname).toBe('/');
      },
    );
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('未ログインの閲覧者が開いたダイアログで、アクセシビリティの検査の違反が0件', async () => {
      await renderButton();
      await userEvent.click(subscribeButton());
      await expect.element(dialog()).toBeVisible();

      expect(await runAxe(dialog().element())).toStrictEqual([]);
    });

    test('未確認の理由の表示中に、アクセシビリティの検査の違反が0件', async () => {
      await renderButton({ viewerQuery: UNVERIFIED_VIEWER });
      await expect
        .element(page.getByText(EMAIL_UNVERIFIED_REASON))
        .toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });

    test('価格が無いときの無効なボタンで、アクセシビリティの検査の違反が0件', async () => {
      await renderButton({
        viewerQuery: VERIFIED_VIEWER,
        priceAvailable: false,
      });
      await expect.element(subscribeButton()).toBeDisabled();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });

    test('加入の開始の失敗の表示中に、アクセシビリティの検査の違反が0件', async () => {
      const [code, status, message] = FAILURES[0] ?? ['', 0, ''];
      respondWithFailure(code, status, message);
      await renderButton({ viewerQuery: VERIFIED_VIEWER });
      await userEvent.click(subscribeButton());
      await expect.element(alert()).toHaveTextContent(message);

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
