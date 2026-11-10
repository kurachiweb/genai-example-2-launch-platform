import { afterEach, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { DirectoryListSkeleton } from './directory-list-skeleton.tsx';

const DESKTOP = { width: 1280, height: 900 } as const;
const TABLET = { width: 900, height: 900 } as const;
const MOBILE = { width: 375, height: 900 } as const;
// Vitestのブラウザテストの既定の表示領域
const DEFAULT_VIEWPORT = { width: 414, height: 896 } as const;

const renderSkeleton = () =>
  render(
    <main className="bg-background p-4 text-foreground">
      <DirectoryListSkeleton />
    </main>,
  );

const status = () =>
  page.getByRole('status', { name: 'プロダクト一覧を読み込み中' });

const itemsOf = (): HTMLElement[] =>
  Array.from(status().element().querySelectorAll<HTMLElement>('li'));

// 項目の中の区画(プロダクト情報・勝利した予選マッチ・操作)を、一覧の項目と同じ並びで取り出す
const partsOf = (item: HTMLElement) => {
  const [info, win, actions] = Array.from(item.children);
  if (info === undefined || win === undefined || actions === undefined) {
    throw new Error('項目の区画が描かれていません。');
  }
  return {
    info: info.getBoundingClientRect(),
    win: win.getBoundingClientRect(),
    actions: actions.getBoundingClientRect(),
  };
};

const firstItem = (): HTMLElement => {
  const [item] = itemsOf();
  if (item === undefined) {
    throw new Error('項目のスケルトンが描かれていません。');
  }
  return item;
};

afterEach(async () => {
  applyColorScheme('light');
  await page.viewport(DEFAULT_VIEWPORT.width, DEFAULT_VIEWPORT.height);
});

describe('DirectoryListSkeleton', () => {
  test('支援技術には「プロダクト一覧を読み込み中」と伝え、形だけの部分は読ませない', async () => {
    await renderSkeleton();

    await expect.element(status()).toBeInTheDocument();
    expect(status().element().textContent).toBe('プロダクト一覧を読み込み中');
    expect(
      status().element().querySelector('[aria-hidden="true"]'),
    ).not.toBeNull();
  });

  test('件数・一覧の項目・ページ送りの形を、件数・項目の並び・ページ送りの順に置く', async () => {
    await renderSkeleton();

    await expect.element(status()).toBeInTheDocument();
    const items = itemsOf();
    expect(items.length).toBeGreaterThanOrEqual(3);
    const count = status()
      .element()
      .querySelector('[data-skeleton="result-count"]');
    const pagination = status()
      .element()
      .querySelector('[data-skeleton="pagination"]');
    expect(count).not.toBeNull();
    expect(pagination).not.toBeNull();
    const list = items[0]?.parentElement?.getBoundingClientRect();
    expect(count?.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      list?.top ?? 0,
    );
    expect(pagination?.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      list?.bottom ?? 0,
    );
  });

  test('項目はロゴの正方形・名称・ボタンの形を保つ', async () => {
    await renderSkeleton();

    await expect.element(status()).toBeInTheDocument();
    const logo = firstItem().querySelector('[data-skeleton="logo"]');
    const name = firstItem().querySelector('[data-skeleton="name"]');
    const button = firstItem().querySelector('[data-skeleton="action"]');
    expect(name).not.toBeNull();
    expect(button).not.toBeNull();
    const logoRect = logo?.getBoundingClientRect();
    expect(logoRect?.width).toBeGreaterThan(0);
    expect(logoRect?.width).toBe(logoRect?.height);
    expect(button?.getBoundingClientRect().height).toBeGreaterThan(0);
  });

  test('画面幅1024px以上では、一覧の項目と同じくプロダクト情報・勝利した予選マッチ・操作を3列に並べる', async () => {
    await page.viewport(DESKTOP.width, DESKTOP.height);
    await renderSkeleton();

    await expect.element(status()).toBeInTheDocument();
    const { info, win, actions } = partsOf(firstItem());
    expect(win.left).toBeGreaterThanOrEqual(info.right);
    expect(actions.left).toBeGreaterThanOrEqual(win.right);
    expect(actions.top).toBeLessThan(win.bottom);
  });

  test('画面幅768px以上1024px未満では2列にし、操作を勝利した予選マッチの下に置く', async () => {
    await page.viewport(TABLET.width, TABLET.height);
    await renderSkeleton();

    await expect.element(status()).toBeInTheDocument();
    const { info, win, actions } = partsOf(firstItem());
    expect(win.left).toBeGreaterThanOrEqual(info.right);
    expect(actions.top).toBeGreaterThanOrEqual(win.bottom);
    expect(actions.left).toBeGreaterThanOrEqual(win.left);
  });

  test('画面幅768px未満では縦に積み、横にはみ出さない', async () => {
    await page.viewport(MOBILE.width, MOBILE.height);
    await renderSkeleton();

    await expect.element(status()).toBeInTheDocument();
    const { info, win, actions } = partsOf(firstItem());
    expect(win.top).toBeGreaterThanOrEqual(info.bottom);
    expect(actions.top).toBeGreaterThanOrEqual(win.bottom);
    expect(firstItem().scrollWidth).toBeLessThanOrEqual(
      firstItem().clientWidth,
    );
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('スケルトンのアクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      await renderSkeleton();

      await expect.element(status()).toBeInTheDocument();
      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
