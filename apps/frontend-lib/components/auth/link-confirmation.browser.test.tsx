import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../../test/computed-style.ts';
import { GraphQLClientError } from '../../utilities/graphql/graphql-result.ts';
import { LinkConfirmation } from './link-confirmation.tsx';

const TOKEN = ['mail', 'link', 'value'].join('_');
const INVALID_LINK_MESSAGE = 'このリンクは無効か、有効期限が切れています。';
const GUIDE = 'もう一度手続きを行ってください。';
const DESCRIPTION = 'ボタンを押すと、変更が完了します。';
const ACTION_LABEL = '変更を確定する';
const SUCCESS_MESSAGE = '変更しました。';
const FAILURE_MESSAGE = '通信に失敗しました。時間をおいて再度お試しください。';

const confirm = vi.fn<(token: string) => Promise<string>>();
const failureMessageOf = vi.fn<(error: unknown) => string>();

const actionButton = () => page.getByRole('button', { name: ACTION_LABEL });

function Confirmation() {
  return (
    <LinkConfirmation
      description={DESCRIPTION}
      actionLabel={ACTION_LABEL}
      confirm={confirm}
      renderSuccess={(result) => <p role="status">{result}</p>}
      invalidLinkMessage={INVALID_LINK_MESSAGE}
      invalidLinkGuide={<p>{GUIDE}</p>}
      failureMessageOf={failureMessageOf}
    />
  );
}

async function renderAt(path: string) {
  const router = createRouter({
    routeTree: createRootRoute({ component: Confirmation }),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await render(<RouterProvider router={router} />);
  return router;
}

const invalidLink = () =>
  new GraphQLClientError({
    code: 'invalid_link',
    message: INVALID_LINK_MESSAGE,
    status: 422,
  });

beforeEach(() => {
  confirm.mockReset();
  failureMessageOf.mockReset();
  failureMessageOf.mockReturnValue(FAILURE_MESSAGE);
});

afterEach(() => {
  applyColorScheme('light');
});

describe('LinkConfirmation', () => {
  test('リンクを開いただけでは確定せず、説明と確定のボタンを示してフラグメントを消す', async () => {
    const router = await renderAt(`/links/confirm#token=${TOKEN}`);

    await expect.element(actionButton()).toBeVisible();
    await expect.element(page.getByText(DESCRIPTION)).toBeVisible();
    await expect.poll(() => router.history.location.hash).toBe('');
    expect(confirm).not.toHaveBeenCalled();
  });

  test('ボタンを押すとリンクのトークンで確定し、確定の結果を描く', async () => {
    confirm.mockResolvedValue(SUCCESS_MESSAGE);
    await renderAt(`/links/confirm#token=${TOKEN}`);

    await userEvent.click(actionButton());

    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent(SUCCESS_MESSAGE);
    expect(confirm).toHaveBeenCalledExactlyOnceWith(TOKEN);
    expect(actionButton().elements()).toHaveLength(0);
  });

  test('確定の間はボタンを処理中にし、重ねて押しても1回だけ確定する', async () => {
    let finish: (value: string) => void = () => undefined;
    confirm.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await renderAt(`/links/confirm#token=${TOKEN}`);

    await userEvent.click(actionButton());
    await expect.element(actionButton()).toHaveAttribute('aria-busy', 'true');
    await expect
      .element(actionButton())
      .toHaveAttribute('aria-disabled', 'true');
    await actionButton().click({ force: true });
    finish(SUCCESS_MESSAGE);

    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent(SUCCESS_MESSAGE);
    expect(confirm).toHaveBeenCalledOnce();
  });

  test('無効なリンクの失敗なら、ボタンに代えて無効の文言と手続きの案内を示す', async () => {
    confirm.mockRejectedValue(invalidLink());
    await renderAt(`/links/confirm#token=${TOKEN}`);

    await userEvent.click(actionButton());

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(`${INVALID_LINK_MESSAGE}${GUIDE}`);
    await expect.element(page.getByRole('alert')).toHaveFocus();
    expect(actionButton().elements()).toHaveLength(0);
    expect(failureMessageOf).not.toHaveBeenCalled();
  });

  test('リンクと関係の無い失敗は、呼び出す側が選んだ文言で示し、押し直せる', async () => {
    const failure = new GraphQLClientError({
      code: 'network_error',
      message: FAILURE_MESSAGE,
      status: 0,
    });
    confirm.mockRejectedValueOnce(failure).mockResolvedValue(SUCCESS_MESSAGE);
    await renderAt(`/links/confirm#token=${TOKEN}`);

    await userEvent.click(actionButton());

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(FAILURE_MESSAGE);
    expect(failureMessageOf).toHaveBeenCalledExactlyOnceWith(failure);
    await expect.element(actionButton()).not.toHaveAttribute('aria-disabled');

    await userEvent.click(actionButton());

    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent(SUCCESS_MESSAGE);
    expect(page.getByRole('alert').elements()).toHaveLength(0);
  });

  test('フラグメントにトークンが無ければ、ボタンを描かずに無効なリンクとして示す', async () => {
    await renderAt('/links/confirm');

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(`${INVALID_LINK_MESSAGE}${GUIDE}`);
    expect(actionButton().elements()).toHaveLength(0);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('確定の前と無効なリンクの表示で、アクセシビリティの検査の違反が0件', async () => {
      confirm.mockRejectedValue(invalidLink());
      await renderAt(`/links/confirm#token=${TOKEN}`);
      await expect.element(actionButton()).toBeVisible();
      const idle = await runAxe(document.body);

      await userEvent.click(actionButton());
      await expect.element(page.getByRole('alert')).toBeVisible();

      expect(idle).toStrictEqual([]);
      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
