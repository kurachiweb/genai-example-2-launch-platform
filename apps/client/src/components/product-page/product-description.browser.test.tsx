import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import type { RouterContext } from '../../../lib/start/router-context.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import {
  createPageRouterContext,
  renderInRouter,
} from '../../../test/page-router.tsx';
import { ProductDescription } from './product-description.tsx';

// テストのルーターがログイン中の利用者の取得を読み込むため、サーバーの実行の入口を読み込まないよう差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const COLLAPSED_HEIGHT_PX = 480;

const PARAGRAPH =
  'ピッチの台本を書き、話す速さを測りながら練習できます。本番の前に何度でも通しで確かめられます。';

const SHORT_MARKDOWN = [
  '## 特徴',
  '',
  '[公式サイト](https://pitch-notes.example/)と[使い方](https://client.example/p/Pitch-Notes)を見てください。',
].join('\n');

const LONG_MARKDOWN = [
  '## 特徴',
  '',
  ...Array.from({ length: 30 }, () => [PARAGRAPH, '']).flat(),
  '[末尾のリンク](https://pitch-notes.example/docs)',
].join('\n');

const renderDescription = (markdown: string) =>
  renderInRouter(
    <main className="mx-auto max-w-3xl bg-background p-4 text-foreground">
      <ProductDescription markdown={markdown} />
    </main>,
  );

const bodyOf = (): HTMLElement => {
  const body = document.querySelector<HTMLElement>(
    '[data-slot="collapsible-markdown-body"]',
  );
  if (body === null) {
    throw new Error('説明文の本文が描画されていません。');
  }
  return body;
};

const readMoreButton = () => page.getByRole('button', { name: '続きを読む' });

afterEach(() => {
  applyColorScheme('light');
});

describe('ProductDescription', () => {
  test('見出し「説明」の区画にマークダウンを描画する', async () => {
    await renderDescription(SHORT_MARKDOWN);

    await expect
      .element(page.getByRole('region', { name: '説明' }))
      .toBeVisible();
    await expect
      .element(page.getByRole('heading', { level: 2, name: '説明' }))
      .toBeVisible();
    await expect
      .element(page.getByRole('heading', { name: '特徴' }))
      .toBeVisible();
  });

  test('外部のリンクはrel="noopener"で別タブに開き、同じサイトのリンクは同じタブで開く', async () => {
    await renderDescription(SHORT_MARKDOWN);

    const external = page.getByRole('link', { name: '公式サイト' });
    await expect.element(external).toHaveAttribute('target', '_blank');
    await expect.element(external).toHaveAttribute('rel', 'noopener');
    const sameOrigin = page.getByRole('link', { name: '使い方' });
    await expect.element(sameOrigin).not.toHaveAttribute('target');
    await expect.element(sameOrigin).not.toHaveAttribute('rel');
  });

  test('480px以下の説明文は折りたたまず、「続きを読む」を出さない', async () => {
    await renderDescription(SHORT_MARKDOWN);
    await expect
      .element(page.getByRole('link', { name: '公式サイト' }))
      .toBeVisible();

    await expect.poll(() => bodyOf().style.maxHeight).toBe('');
    expect(readMoreButton().elements()).toStrictEqual([]);
  });

  test('480pxを超える説明文は折りたたみ、「続きを読む」で全文を表示する', async () => {
    await renderDescription(LONG_MARKDOWN);

    await expect.element(readMoreButton()).toBeVisible();
    expect(bodyOf().getBoundingClientRect().height).toBe(COLLAPSED_HEIGHT_PX);
    await expect
      .element(readMoreButton())
      .toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(readMoreButton());

    await expect
      .element(page.getByRole('button', { name: '折りたたむ' }))
      .toHaveAttribute('aria-expanded', 'true');
    expect(bodyOf().getBoundingClientRect().height).toBeGreaterThan(
      COLLAPSED_HEIGHT_PX,
    );
    await expect
      .element(page.getByRole('link', { name: '末尾のリンク' }))
      .toBeVisible();
  });

  test('サーバー側の描画では初めから480pxで折りたたみ、切替ボタンを含めない', () => {
    const context: RouterContext = createPageRouterContext('local');
    const router = createRouter({
      routeTree: createRootRouteWithContext<RouterContext>()(),
      history: createMemoryHistory(),
      context,
    });

    const html = renderToString(
      <RouterContextProvider router={router}>
        <ProductDescription markdown={LONG_MARKDOWN} />
      </RouterContextProvider>,
    );

    expect(html).toContain(`max-height:${COLLAPSED_HEIGHT_PX.toString()}px`);
    expect(html).not.toContain('続きを読む');
  });

  test.each(COLOR_SCHEMES)(
    '%sの配色で折りたたみ中と展開後のaxeの違反が0件である',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderDescription(LONG_MARKDOWN);
      await expect.element(readMoreButton()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);

      await userEvent.click(readMoreButton());
      await expect
        .element(page.getByRole('button', { name: '折りたたむ' }))
        .toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
