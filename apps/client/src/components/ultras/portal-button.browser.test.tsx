import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import { ClientCreateUltrasPortalSessionDocument } from '../../graphql/generated/graphql.ts';
import { PortalButton } from './portal-button.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const PORTAL_URL = 'https://billing.stripe.example/session/test_portal_0001';

const BUTTON_LABEL = '解約・支払い方法の管理';

const PENDING_LABEL = '送信中';

const DESCRIPTION =
  '支払い方法の更新・解約・解約の取り消しは、Stripeの管理画面で行います。';

const UNAVAILABLE_TITLE = '現在ご利用いただけません。';

const PORTAL_UNAVAILABLE_REASON =
  '決済サービスで障害が発生しているため、支払い方法の更新・解約・解約の取り消しを現在ご利用いただけません。しばらく待ってから再度お試しください。閲覧やその他の操作は引き続きご利用いただけます。';

// APIサーバーが文言規則の文言を返す契約のため、ブラウザテストではコードごとの失敗の結果をそのまま返させる
const FAILURES: readonly (readonly [string, number, string])[] = [
  [
    'ultras_portal_unavailable',
    422,
    'Ultrasに加入したことが無いため、管理画面を開けません。',
  ],
  [
    'rate_limit_exceeded',
    429,
    '操作が集中しています。しばらく待ってから再度お試しください。',
  ],
  [
    'account_unavailable',
    403,
    'このアカウントは現在ご利用いただけません。詳しくはお問い合わせください。',
  ],
];

const deferred = <T,>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

const respondWithUrl = () => {
  executeGraphQL.mockResolvedValue({
    ok: true,
    data: { createUltrasPortalSession: { url: PORTAL_URL } },
  });
};

const respondWithFailure = (code: string, status: number, message: string) => {
  executeGraphQL.mockResolvedValue({
    ok: false,
    error: new GraphQLClientError({ code, message, status }),
  });
};

const renderButton = async () => {
  const navigateTo = vi.fn<(url: string) => void>();
  await renderInRouter(
    <main>
      <PortalButton navigateTo={navigateTo} />
    </main>,
    { cachedViewer: signedInViewerQuery() },
  );
  return navigateTo;
};

const portalButton = () => page.getByRole('button', { name: BUTTON_LABEL });
const pendingButton = () => page.getByRole('button', { name: PENDING_LABEL });
const alert = () => page.getByRole('alert');
const status = () => page.getByRole('status');

// 送信中のaria-disabledのボタンはポインターの操作を受けないがTabの停止位置に残りEnterも止めないため、キーボードで押して処理側が無視することを確かめる
const pressByKeyboard = async (button: ReturnType<typeof pendingButton>) => {
  (button.element() as HTMLElement).focus();
  await userEvent.keyboard('{Enter}');
};

beforeEach(() => {
  executeGraphQL.mockReset();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('PortalButton', () => {
  test('ボタン「解約・支払い方法の管理」を、Stripeの管理画面で行う旨の説明を結び付けて描き、押すまで何も送らない', async () => {
    await renderButton();

    await expect.element(portalButton()).toBeEnabled();
    await expect
      .element(portalButton())
      .toHaveAccessibleDescription(DESCRIPTION);
    await expect
      .element(page.getByText(DESCRIPTION, { exact: true }))
      .toBeVisible();
    expect(executeGraphQL).not.toHaveBeenCalled();
  });

  test('押すとCustomer Portalのセッションを作る変更を送り、得たURLへ移動する', async () => {
    respondWithUrl();
    const navigateTo = await renderButton();

    await userEvent.click(portalButton());

    await expect.poll(() => navigateTo.mock.calls).toEqual([[PORTAL_URL]]);
    expect(executeGraphQL).toHaveBeenCalledTimes(1);
    expect(executeGraphQL).toHaveBeenCalledWith(
      ClientCreateUltrasPortalSessionDocument,
      {},
      expect.anything(),
    );
  });

  test('送信中はボタンを処理中の表示にし、重ねて押しても送り直さない', async () => {
    const pending = deferred<unknown>();
    executeGraphQL.mockReturnValue(pending.promise);
    const navigateTo = await renderButton();

    await userEvent.click(portalButton());

    await expect.element(pendingButton()).toHaveAttribute('aria-busy', 'true');
    await expect
      .element(pendingButton())
      .toHaveAttribute('aria-disabled', 'true');
    await pressByKeyboard(pendingButton());
    expect(executeGraphQL).toHaveBeenCalledTimes(1);

    pending.resolve({
      ok: true,
      data: { createUltrasPortalSession: { url: PORTAL_URL } },
    });

    await expect.poll(() => navigateTo.mock.calls).toEqual([[PORTAL_URL]]);
  });

  test('Customer Portalへ移った後にブラウザの「戻る」でbfcacheから復元されると、ボタンを押せる状態に戻す', async () => {
    respondWithUrl();
    const navigateTo = await renderButton();
    await userEvent.click(portalButton());
    await expect.poll(() => navigateTo.mock.calls).toEqual([[PORTAL_URL]]);
    await expect.element(pendingButton()).toHaveAttribute('aria-busy', 'true');

    window.dispatchEvent(
      new PageTransitionEvent('pageshow', { persisted: true }),
    );

    await expect.element(portalButton()).toBeEnabled();
    expect(portalButton().element()).not.toHaveAttribute('aria-busy');
    expect(portalButton().element()).not.toHaveAttribute('aria-disabled');
  });

  test('決済サービスの障害では、題名「現在ご利用いただけません。」とCustomer Portalを利用できない理由の注記を示し、移動しない', async () => {
    respondWithFailure(
      'payments_unavailable',
      503,
      '現在、決済をご利用いただけません。決済サービスで障害が発生しています。閲覧やその他の操作は引き続きご利用いただけます。',
    );
    const navigateTo = await renderButton();

    await userEvent.click(portalButton());

    await expect.element(status()).toHaveTextContent(UNAVAILABLE_TITLE);
    await expect.element(status()).toHaveTextContent(PORTAL_UNAVAILABLE_REASON);
    expect(alert().query()).toBeNull();
    await expect.element(portalButton()).toBeEnabled();
    expect(navigateTo).not.toHaveBeenCalled();
  });

  test.each(FAILURES)(
    '%sの失敗では、サーバーの文言をボタンの近くに示して結び付け、移動しない',
    async (code, httpStatus, message) => {
      respondWithFailure(code, httpStatus, message);
      const navigateTo = await renderButton();

      await userEvent.click(portalButton());

      await expect.element(alert()).toHaveTextContent(message);
      await expect
        .element(portalButton())
        .toHaveAccessibleDescription(`${DESCRIPTION} ${message}`);
      expect(status().query()).toBeNull();
      expect(navigateTo).not.toHaveBeenCalled();
    },
  );

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('ボタンと説明の表示で、アクセシビリティの検査の違反が0件', async () => {
      await renderButton();
      await expect.element(portalButton()).toBeEnabled();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });

    test('縮退運転の注記の表示で、アクセシビリティの検査の違反が0件', async () => {
      respondWithFailure('payments_unavailable', 503, '障害');
      await renderButton();
      await userEvent.click(portalButton());
      await expect.element(status()).toHaveTextContent(UNAVAILABLE_TITLE);

      expect(await runAxe(document.body)).toStrictEqual([]);
    });

    test('失敗の文言の表示で、アクセシビリティの検査の違反が0件', async () => {
      respondWithFailure('rate_limit_exceeded', 429, '操作が集中しています。');
      await renderButton();
      await userEvent.click(portalButton());
      await expect.element(alert()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
