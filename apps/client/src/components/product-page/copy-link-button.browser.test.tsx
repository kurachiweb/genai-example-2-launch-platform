import { toast } from 'sonner';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { Toaster } from '../../../lib/components/feedback/toaster.tsx';
import { TooltipProvider } from '../../../lib/components/ui/tooltip/tooltip-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import {
  CopyLinkButton,
  type CopyLinkButtonProps,
} from './copy-link-button.tsx';

// テストのルーターがログイン中の利用者の取得を読み込むため、サーバーの実行の入口を読み込まないよう差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

// テストのルーターの文脈の利用者側のオリジン
const CANONICAL_URL = 'https://client.example/p/Pitch-Notes';

const COPIED = 'リンクをコピーしました。';
const COPY_FAILED = 'リンクをコピーできませんでした。';

const renderButton = (props: Partial<CopyLinkButtonProps> = {}) =>
  renderInRouter(
    <TooltipProvider>
      <main className="bg-background p-4 text-foreground">
        <CopyLinkButton path="/p/Pitch-Notes" {...props} />
      </main>
      <Toaster />
    </TooltipProvider>,
    { path: '/p/pitch-notes?from=share' },
  );

const copyButton = () => page.getByRole('button', { name: 'リンクをコピー' });

const stubClipboardWrite = (implementation: (text: string) => Promise<void>) =>
  vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(implementation);

afterEach(() => {
  vi.restoreAllMocks();
  toast.dismiss();
  applyColorScheme('light');
});

describe('CopyLinkButton', () => {
  test('画面はアイコンだけで、名前とツールチップを「リンクをコピー」にする', async () => {
    await renderButton();

    await expect.element(copyButton()).toBeVisible();
    expect(copyButton().element().textContent).toBe('');
    await userEvent.hover(copyButton());
    await expect
      .element(page.getByRole('tooltip', { name: 'リンクをコピー' }))
      .toBeInTheDocument();
  });

  test('表示中のURLではなく、利用者側のオリジンの正規のURLを写し、成功を通知する', async () => {
    const writeText = stubClipboardWrite(() => Promise.resolve());
    await renderButton();

    await userEvent.click(copyButton());

    await expect.element(page.getByText(COPIED)).toBeVisible();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(CANONICAL_URL);
    expect(page.getByText(COPY_FAILED).elements()).toStrictEqual([]);
  });

  test('書き込みが拒まれた時は失敗を通知する', async () => {
    stubClipboardWrite(() =>
      Promise.reject(new DOMException('拒否', 'NotAllowedError')),
    );
    await renderButton();

    await userEvent.click(copyButton());

    await expect.element(page.getByText(COPY_FAILED)).toBeVisible();
    expect(page.getByText(COPIED).elements()).toStrictEqual([]);
  });

  test('クリップボードを使えない環境では失敗を通知する', async () => {
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue(
      undefined as unknown as Clipboard,
    );
    await renderButton();

    await userEvent.click(copyButton());

    await expect.element(page.getByText(COPY_FAILED)).toBeVisible();
  });

  test('文言を渡すとアイコンと文言のボタンにし、同じく正規のURLを写す', async () => {
    const writeText = stubClipboardWrite(() => Promise.resolve());
    await renderButton({ label: 'リンクをコピーして応援を呼びかける' });

    const button = page.getByRole('button', {
      name: 'リンクをコピーして応援を呼びかける',
    });
    await expect
      .element(button)
      .toHaveTextContent('リンクをコピーして応援を呼びかける');
    await userEvent.click(button);

    await expect.element(page.getByText(COPIED)).toBeVisible();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(CANONICAL_URL);
  });

  test('キーボードで押せる', async () => {
    const writeText = stubClipboardWrite(() => Promise.resolve());
    await renderButton();

    await userEvent.tab();
    expect(document.activeElement).toBe(copyButton().element());
    await userEvent.keyboard('{Enter}');

    await expect.element(page.getByText(COPIED)).toBeVisible();
    expect(writeText).toHaveBeenCalledOnce();
  });

  test.each(COLOR_SCHEMES)(
    '%sの配色で、通知の表示中もaxeの違反が0件である',
    async (scheme) => {
      applyColorScheme(scheme);
      stubClipboardWrite(() => Promise.resolve());
      await renderButton();

      expect(await runAxe(document.body)).toStrictEqual([]);
      await userEvent.click(copyButton());
      await expect.element(page.getByText(COPIED)).toBeVisible();
      // 通知は表示の後のフレームで現れる動きを始めるため、透明な途中の色でコントラストを測らないよう現れ終わるのを待つ
      await expect
        .poll(() => {
          const toastItem = page
            .getByText(COPIED)
            .element()
            .closest('[data-sonner-toast]');
          return toastItem === null ? '' : getComputedStyle(toastItem).opacity;
        })
        .toBe('1');
      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
