import { afterEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import { ProductBreadcrumbs } from './product-breadcrumbs.tsx';

// テストのルーターがログイン中の利用者の取得を読み込むため、サーバーの実行の入口を読み込まないよう差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const CATEGORY = { name: '開発ツール', handle: 'dev-tools' };

const renderBreadcrumbs = (path = '/p/Pitch-Notes') =>
  renderInRouter(
    <main className="bg-background p-4 text-foreground">
      <ProductBreadcrumbs category={CATEGORY} name="Pitch Notes" />
    </main>,
    { path },
  );

const breadcrumbs = () =>
  page.getByRole('navigation', { name: 'パンくずリスト' });

afterEach(() => {
  applyColorScheme('light');
});

describe('ProductBreadcrumbs', () => {
  test('「ディレクトリ」・カテゴリ名・名称の順に並べ、ディレクトリとカテゴリで絞り込んだディレクトリへ導く', async () => {
    await renderBreadcrumbs();

    const items = breadcrumbs().getByRole('listitem').elements();
    expect(items.map((item) => item.textContent)).toStrictEqual([
      'ディレクトリ',
      '開発ツール',
      'Pitch Notes',
    ]);
    await expect
      .element(breadcrumbs().getByRole('link', { name: 'ディレクトリ' }))
      .toHaveAttribute('href', '/p');
    await expect
      .element(breadcrumbs().getByRole('link', { name: '開発ツール' }))
      .toHaveAttribute('href', '/p?category=dev-tools');
  });

  test('名称だけを現在のページと伝え、リンクにしない', async () => {
    await renderBreadcrumbs();

    const current = breadcrumbs().getByText('Pitch Notes').element();
    expect(current.closest('a')).toBeNull();
    expect(current.closest('[aria-current="page"]')).not.toBeNull();
    expect(
      breadcrumbs()
        .getByRole('link')
        .elements()
        .map((link) => link.getAttribute('aria-current')),
    ).toStrictEqual([null, null]);
  });

  test('ディレクトリを表示中でも、ディレクトリのリンクを現在のページと伝えない', async () => {
    await renderBreadcrumbs('/p');

    await expect
      .element(breadcrumbs().getByRole('link', { name: 'ディレクトリ' }))
      .not.toHaveAttribute('aria-current');
  });

  test('区切りの記号は支援技術から隠す', async () => {
    await renderBreadcrumbs();

    const separators = breadcrumbs().element().querySelectorAll('svg');
    expect(separators).toHaveLength(2);
    expect(
      Array.from(separators, (separator) =>
        separator.getAttribute('aria-hidden'),
      ),
    ).toStrictEqual(['true', 'true']);
  });

  test.each(COLOR_SCHEMES)('%sの配色でaxeの違反が0件である', async (scheme) => {
    applyColorScheme(scheme);
    await renderBreadcrumbs();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
