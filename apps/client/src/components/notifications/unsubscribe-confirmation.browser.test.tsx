import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import {
  createPageRouterContext,
  renderInRouter,
} from '../../../test/page-router.tsx';
import {
  API_INVALID_LINK_MESSAGE,
  confirmedUnsubscribeResult,
  failedResult,
  INVALID_LINK_MESSAGE,
  invalidLinkFailure,
  UNSUBSCRIBE_FAILED_MESSAGE,
  UNSUBSCRIBE_TOKEN,
  unsubscribeLinkResult,
} from '../../../test/unsubscribe-fixtures.ts';
import {
  signedInViewerQuery,
  VIEWER_HANDLE,
  VIEWER_NICKNAME,
} from '../../../test/viewer-fixtures.ts';
import {
  ClientConfirmNotificationUnsubscribeDocument,
  ClientNotificationUnsubscribeLinkDocument,
} from '../../graphql/generated/graphql.ts';
import { UnsubscribeConfirmation } from './unsubscribe-confirmation.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const PATH = '/unsubscribe';
const QUESTION = '「勝敗結果」の通知メールの配信を停止しますか?';
const DONE_MESSAGE =
  '「勝敗結果」の通知メールの配信を停止しました。通知設定からいつでも再開できます。';
const ALREADY_MESSAGE = '「勝敗結果」の通知メールは既に配信を停止しています。';

type Responder = () => Promise<unknown>;

const callsOf = (target: unknown) =>
  executeGraphQL.mock.calls.filter(([document]) => document === target);

function respond({
  link = () => Promise.resolve(unsubscribeLinkResult(subscribedLink)),
  confirm = () => Promise.resolve(confirmedUnsubscribeResult('MATCH_RESULT')),
}: { readonly link?: Responder; readonly confirm?: Responder } = {}): void {
  executeGraphQL.mockImplementation((document: unknown) => {
    if (document === ClientNotificationUnsubscribeLinkDocument) {
      return link();
    }
    if (document === ClientConfirmNotificationUnsubscribeDocument) {
      return confirm();
    }
    throw new Error('想定していない操作が実行されました。');
  });
}

const subscribedLink = Object.freeze({
  topic: 'MATCH_RESULT' as const,
  enabled: true,
});

const alreadyDisabledLink = Object.freeze({
  topic: 'MATCH_RESULT' as const,
  enabled: false,
});

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const renderAt = (hash: string) =>
  renderInRouter(
    <main>
      <h1>配信停止</h1>
      <UnsubscribeConfirmation />
    </main>,
    {
      path: `${PATH}${hash}`,
      context: createPageRouterContext('local'),
      cachedViewer: signedInViewerQuery(),
    },
  );

const renderWithToken = () => renderAt(`#token=${UNSUBSCRIBE_TOKEN}`);

const confirmButton = () =>
  page.getByRole('button', { name: '配信を停止する' });
const retryButton = () => page.getByRole('button', { name: '再試行' });
const settingsLink = () => page.getByRole('link', { name: '通知設定を開く' });

beforeEach(() => {
  executeGraphQL.mockReset();
  respond();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('UnsubscribeConfirmation', () => {
  test('フラグメントからトークンを読んでURLから消し、開いただけでは照会だけを送って確定の操作を送らない', async () => {
    const router = await renderWithToken();

    await expect
      .element(page.getByText(QUESTION, { exact: true }))
      .toBeVisible();
    await expect.element(confirmButton()).toBeEnabled();
    await expect.poll(() => router.history.location.hash).toBe('');
    expect(router.state.location.pathname).toBe(PATH);
    const linkCalls = callsOf(ClientNotificationUnsubscribeLinkDocument);
    expect(linkCalls).toHaveLength(1);
    expect(linkCalls[0]?.[1]).toStrictEqual({ token: UNSUBSCRIBE_TOKEN });
    expect(callsOf(ClientConfirmNotificationUnsubscribeDocument)).toHaveLength(
      0,
    );
  });

  test('照会の応答を待つ間は、読み込み中の表示を示して確認のボタンを出さない', async () => {
    const pending = deferred<unknown>();
    respond({ link: () => pending.promise });
    await renderWithToken();

    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent('読み込み中');
    expect(confirmButton().elements()).toHaveLength(0);

    pending.resolve(unsubscribeLinkResult(subscribedLink));

    await expect.element(confirmButton()).toBeVisible();
  });

  test('フラグメントにトークンが無ければ、照会を送らずに無効の文言と通知設定への導線を示す', async () => {
    await renderAt('');

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(INVALID_LINK_MESSAGE);
    await expect.element(page.getByRole('alert')).toHaveFocus();
    await expect
      .element(settingsLink())
      .toHaveAttribute('href', '/settings/notifications');
    expect(executeGraphQL).not.toHaveBeenCalled();
    expect(page.getByRole('button').elements()).toHaveLength(0);
  });

  test.each([
    ['照会の結果が無い', () => Promise.resolve(unsubscribeLinkResult(null))],
    [
      '照会がinvalid_linkで失敗した',
      () => Promise.resolve(invalidLinkFailure()),
    ],
    [
      'トークンの長さの検証で失敗した',
      () =>
        Promise.resolve(
          failedResult({
            code: 'validation_error',
            message: '入力内容を確認してください。',
            status: 400,
            details: [
              {
                field: 'token',
                code: 'too_big',
                message: API_INVALID_LINK_MESSAGE,
              },
            ],
          }),
        ),
    ],
  ])(
    '%sときは、APIの文言を出さずに無効の文言と通知設定への導線を示す',
    async (_case, link) => {
      respond({ link });
      await renderWithToken();

      await expect
        .element(page.getByRole('alert'))
        .toHaveTextContent(INVALID_LINK_MESSAGE);
      await expect.element(settingsLink()).toBeVisible();
      expect(document.body.textContent).not.toContain(API_INVALID_LINK_MESSAGE);
      expect(page.getByRole('button').elements()).toHaveLength(0);
    },
  );

  test('その通知種別が既に受信しない設定なら、既に停止している旨を示して確認のボタンを出さない', async () => {
    respond({
      link: () => Promise.resolve(unsubscribeLinkResult(alreadyDisabledLink)),
    });
    await renderWithToken();

    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent(ALREADY_MESSAGE);
    expect(page.getByRole('button').elements()).toHaveLength(0);
    expect(callsOf(ClientConfirmNotificationUnsubscribeDocument)).toHaveLength(
      0,
    );
  });

  test('確認のボタンを押すとトークンで確定の操作を送り、停止した旨と「通知設定を開く」を示す', async () => {
    await renderWithToken();

    await userEvent.click(confirmButton());

    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent(DONE_MESSAGE);
    await expect.element(page.getByRole('status')).toHaveFocus();
    await expect
      .element(settingsLink())
      .toHaveAttribute('href', '/settings/notifications');
    expect(callsOf(ClientConfirmNotificationUnsubscribeDocument)).toStrictEqual(
      [
        [
          ClientConfirmNotificationUnsubscribeDocument,
          { token: UNSUBSCRIBE_TOKEN },
          { turnstileToken: undefined },
        ],
      ],
    );
    expect(page.getByRole('button').elements()).toHaveLength(0);
  });

  test('確定の送信中はボタンをaria-disabledとaria-busyにしてフォーカスを保ち、重ねた押下を送らない', async () => {
    const pending = deferred<unknown>();
    respond({ confirm: () => pending.promise });
    await renderWithToken();

    await userEvent.click(confirmButton());

    await expect.element(confirmButton()).toHaveAttribute('aria-busy', 'true');
    await expect
      .element(confirmButton())
      .toHaveAttribute('aria-disabled', 'true');
    await expect.element(confirmButton()).toHaveFocus();
    await userEvent.click(confirmButton(), { force: true });
    expect(callsOf(ClientConfirmNotificationUnsubscribeDocument)).toHaveLength(
      1,
    );

    pending.resolve(confirmedUnsubscribeResult('MATCH_RESULT'));

    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent(DONE_MESSAGE);
  });

  test('確定に失敗したら、APIの文言を出さずに停止できなかった旨と再試行のボタンを示し、再試行で確定の操作をもう一度送る', async () => {
    const apiMessage = '通信に失敗しました。時間をおいて再度お試しください。';
    const confirm = vi
      .fn<Responder>()
      .mockResolvedValueOnce(
        failedResult({ code: 'network_error', message: apiMessage, status: 0 }),
      )
      .mockResolvedValueOnce(confirmedUnsubscribeResult('MATCH_RESULT'));
    respond({ confirm });
    await renderWithToken();

    await userEvent.click(confirmButton());

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(UNSUBSCRIBE_FAILED_MESSAGE);
    expect(document.body.textContent).not.toContain(apiMessage);
    await expect.element(retryButton()).toHaveFocus();
    expect(confirmButton().elements()).toHaveLength(0);

    await userEvent.click(retryButton());

    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent(DONE_MESSAGE);
    expect(callsOf(ClientConfirmNotificationUnsubscribeDocument)).toHaveLength(
      2,
    );
  });

  test('確定がinvalid_linkで失敗したら、確認のボタンに代えて無効の文言と通知設定への導線を示す', async () => {
    respond({ confirm: () => Promise.resolve(invalidLinkFailure()) });
    await renderWithToken();

    await userEvent.click(confirmButton());

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(INVALID_LINK_MESSAGE);
    await expect.element(page.getByRole('alert')).toHaveFocus();
    await expect.element(settingsLink()).toBeVisible();
    expect(page.getByRole('button').elements()).toHaveLength(0);
  });

  test('照会に失敗したら、停止できなかった旨と再試行のボタンを示し、再試行で照会し直して確認のボタンへフォーカスを移す', async () => {
    const apiMessage = 'サーバーでエラーが発生しました。';
    const link = vi
      .fn<Responder>()
      .mockResolvedValueOnce(
        failedResult({
          code: 'internal_error',
          message: apiMessage,
          status: 500,
        }),
      )
      .mockResolvedValueOnce(unsubscribeLinkResult(subscribedLink));
    respond({ link });
    await renderWithToken();

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(UNSUBSCRIBE_FAILED_MESSAGE);
    expect(document.body.textContent).not.toContain(apiMessage);
    expect(confirmButton().elements()).toHaveLength(0);

    await userEvent.click(retryButton());

    await expect
      .element(page.getByText(QUESTION, { exact: true }))
      .toBeVisible();
    await expect.element(confirmButton()).toHaveFocus();
    expect(page.getByRole('alert').elements()).toHaveLength(0);
    expect(callsOf(ClientNotificationUnsubscribeLinkDocument)).toHaveLength(2);
    expect(callsOf(ClientConfirmNotificationUnsubscribeDocument)).toHaveLength(
      0,
    );
  });

  test('ログイン中の利用者が開いても、ニックネームやハンドルなどの個人情報を表示しない', async () => {
    await renderWithToken();
    await expect.element(confirmButton()).toBeVisible();

    await userEvent.click(confirmButton());
    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent(DONE_MESSAGE);

    const text = document.body.textContent;
    expect(text).not.toContain(VIEWER_NICKNAME);
    expect(text).not.toContain(VIEWER_HANDLE);
    expect(text).not.toContain('@');
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('確認の表示で、アクセシビリティの検査の違反が0件', async () => {
      await renderWithToken();
      await expect.element(confirmButton()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });

    test('確定の失敗の表示で、アクセシビリティの検査の違反が0件', async () => {
      respond({
        confirm: () =>
          Promise.resolve(
            failedResult({
              code: 'network_error',
              message: '通信に失敗しました。',
              status: 0,
            }),
          ),
      });
      await renderWithToken();
      await userEvent.click(confirmButton());
      await expect.element(retryButton()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });

    test('完了の表示で、アクセシビリティの検査の違反が0件', async () => {
      await renderWithToken();
      await userEvent.click(confirmButton());
      await expect.element(settingsLink()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });

    test('既に停止の表示で、アクセシビリティの検査の違反が0件', async () => {
      respond({
        link: () => Promise.resolve(unsubscribeLinkResult(alreadyDisabledLink)),
      });
      await renderWithToken();
      await expect
        .element(page.getByRole('status'))
        .toHaveTextContent(ALREADY_MESSAGE);

      expect(await runAxe(document.body)).toStrictEqual([]);
    });

    test('無効の表示で、アクセシビリティの検査の違反が0件', async () => {
      await renderAt('');
      await expect.element(settingsLink()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
