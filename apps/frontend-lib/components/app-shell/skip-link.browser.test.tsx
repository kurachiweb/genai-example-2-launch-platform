import { describe, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import { MAIN_CONTENT_ID } from './main-content.ts';
import { SkipLink } from './skip-link.tsx';

const SKIP_LABEL = '本文へ移動';

const skipLink = () => page.getByRole('link', { name: SKIP_LABEL });
const mainContent = () => page.getByRole('main');

// 視覚的に隠した要素は1px四方に切り抜かれ、可視性の判定では表示扱いになるため、描画された大きさで確かめる
function renderedSizeOf(element: Element): {
  readonly width: number;
  readonly height: number;
} {
  const { width, height } = element.getBoundingClientRect();
  return { width, height };
}

interface ShellProps {
  readonly mainTabIndex?: number;
}

function Shell({ mainTabIndex }: ShellProps) {
  return (
    <div className="bg-background text-foreground">
      <SkipLink />
      <header className="flex gap-4 p-4">
        <a href="/">ロゴ</a>
        <nav aria-label="メイン">
          <a href="/p">ディレクトリ</a>
        </nav>
      </header>
      <main id={MAIN_CONTENT_ID} tabIndex={mainTabIndex} className="p-4">
        <h1>本文の見出し</h1>
        <button type="button">本文の操作</button>
      </main>
    </div>
  );
}

describe('SkipLink', () => {
  test('最初のTabで「本文へ移動」へフォーカスし、フォーカスの間は画面に表示する', async () => {
    await render(<Shell />);

    expect(renderedSizeOf(skipLink().element())).toStrictEqual({
      width: 1,
      height: 1,
    });

    await userEvent.tab();

    await expect.element(skipLink()).toHaveFocus();
    const focusedSize = renderedSizeOf(skipLink().element());
    expect(focusedSize.width).toBeGreaterThan(1);
    expect(focusedSize.height).toBeGreaterThan(1);
    expect(getComputedStyle(skipLink().element()).paddingLeft).toBe('16px');
    await expect
      .element(skipLink())
      .toHaveAttribute('href', `#${MAIN_CONTENT_ID}`);
  });

  test.each([
    ['フォーカスできない本文', undefined],
    ['tabIndexが-1の本文', -1],
  ])(
    '%sでも、Enterで本文へフォーカスを移し、次のTabで本文の最初の操作へ進む',
    async (_name, mainTabIndex) => {
      await render(<Shell mainTabIndex={mainTabIndex} />);
      const hashBefore = window.location.hash;

      await userEvent.tab();
      await userEvent.keyboard('{Enter}');

      await expect.element(mainContent()).toHaveFocus();
      expect(window.location.hash).toBe(hashBefore);

      await userEvent.tab();

      await expect
        .element(page.getByRole('button', { name: '本文の操作' }))
        .toHaveFocus();
    },
  );

  test('本文の要素が無いページでは、リンクの既定の移動に任せる', async () => {
    const pathBefore = `${window.location.pathname}${window.location.search}`;
    await render(<SkipLink />);

    await userEvent.tab();
    await userEvent.keyboard('{Enter}');

    await expect.poll(() => window.location.hash).toBe(`#${MAIN_CONTENT_ID}`);
    window.history.replaceState(window.history.state, '', pathBefore);
  });

  test('クリックでも本文へフォーカスを移す', async () => {
    await render(<Shell />);

    await userEvent.tab();
    await userEvent.click(skipLink());

    await expect.element(mainContent()).toHaveFocus();
  });

  test('フォーカスした状態でアクセシビリティの自動検査の違反が0件', async () => {
    const { container } = await render(<Shell />);

    await userEvent.tab();
    await expect.element(skipLink()).toHaveFocus();

    expect(await runAxe(container)).toStrictEqual([]);
  });
});
