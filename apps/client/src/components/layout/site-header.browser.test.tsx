import { beforeEach, describe, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { TooltipProvider } from '../../../lib/components/ui/tooltip/tooltip-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import { SiteHeader } from './site-header.tsx';

const MOBILE_VIEWPORT = { width: 375, height: 800 } as const;
const WIDENED_VIEWPORT = { width: 1024, height: 800 } as const;

function TestLaunchAction() {
  return <a href="#launch">ローンチする</a>;
}

function TestAccount() {
  return <a href="#login">ログイン</a>;
}

const menuButton = () => page.getByRole('button', { name: 'メニュー' });
const menu = () => page.getByRole('dialog', { name: 'メニュー' });
const wideNavigationLink = (name: string) =>
  page
    .getByRole('banner')
    .getByRole('navigation', { name: 'メイン' })
    .getByRole('link', { name, exact: true });

async function renderHeader(): Promise<void> {
  await render(
    <TooltipProvider>
      <SiteHeader launchAction={TestLaunchAction} account={TestAccount} />
    </TooltipProvider>,
  );
}

async function openMenuWithKeyboard(): Promise<void> {
  menuButton().element().focus();
  await userEvent.keyboard('{Enter}');
  await expect.element(menu()).toBeInTheDocument();
}

beforeEach(async () => {
  await page.viewport(MOBILE_VIEWPORT.width, MOBILE_VIEWPORT.height);
});

describe('SiteHeader', () => {
  describe('メニューを開いたまま画面幅が変わるとき', () => {
    test('768px以上へ広げると、メニューを閉じ、フォーカスを広い画面のナビゲーションの最初のリンクへ移す', async () => {
      await renderHeader();
      await openMenuWithKeyboard();

      await page.viewport(WIDENED_VIEWPORT.width, WIDENED_VIEWPORT.height);

      await expect.element(menu()).not.toBeInTheDocument();
      await expect.element(wideNavigationLink('ディレクトリ')).toHaveFocus();
      expect(await runAxe(document.body)).toStrictEqual([]);
    });

    test('768px未満のまま幅が変わってもメニューを開いたままにし、閉じるとメニューのボタンへフォーカスを戻す', async () => {
      await renderHeader();
      await openMenuWithKeyboard();

      await page.viewport(MOBILE_VIEWPORT.width + 100, MOBILE_VIEWPORT.height);
      await expect.element(menu()).toBeVisible();
      await userEvent.keyboard('{Escape}');

      await expect.element(menu()).not.toBeInTheDocument();
      await expect.element(menuButton()).toHaveFocus();
    });
  });
});
