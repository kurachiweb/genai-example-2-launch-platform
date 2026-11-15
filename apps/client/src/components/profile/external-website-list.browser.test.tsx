import { afterEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import {
  ExternalWebsiteList,
  type ExternalWebsiteListProps,
} from './external-website-list.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const renderList = (websites: ExternalWebsiteListProps['websites']) =>
  renderInRouter(<ExternalWebsiteList websites={websites} />);

const relOf = (name: string | RegExp): string[] =>
  (page.getByRole('link', { name }).element().getAttribute('rel') ?? '')
    .split(' ')
    .toSorted();

afterEach(() => {
  applyColorScheme('light');
});

describe('ExternalWebsiteList', () => {
  test('名前とホスト名を1件1行で表示し、別タブで開くリンクにする', async () => {
    await renderList([
      { name: '個人サイト', url: 'https://maker.example/portfolio?lang=ja' },
      { name: 'ブログ', url: 'http://blog.example:8080/' },
    ]);

    const list = page.getByRole('list', { name: '外部Webサイト' });
    await expect
      .poll(() => list.getByRole('listitem').elements().length)
      .toBe(2);
    const first = page.getByRole('link', { name: /個人サイト/u });
    await expect
      .element(first)
      .toHaveAttribute('href', 'https://maker.example/portfolio?lang=ja');
    await expect.element(first).toHaveAttribute('target', '_blank');
    await expect.element(first).toHaveTextContent('maker.example');
    await expect
      .element(page.getByRole('link', { name: /ブログ/u }))
      .toHaveAttribute('href', 'http://blog.example:8080/');
  });

  test('リンクのrelはnoopenerとugcにする', async () => {
    await renderList([{ name: '個人サイト', url: 'https://maker.example/' }]);

    await expect
      .element(page.getByRole('link', { name: /個人サイト/u }))
      .toBeVisible();
    expect(relOf(/個人サイト/u)).toStrictEqual(['noopener', 'ugc']);
  });

  test('読み上げに「(新しいタブで開きます)」を添える', async () => {
    await renderList([{ name: '個人サイト', url: 'https://maker.example/' }]);

    await expect
      .element(page.getByRole('link', { name: /個人サイト/u }))
      .toHaveAccessibleName(/\(新しいタブで開きます\)/u);
  });

  test.each([[null], [''], ['   ']])(
    '名前が%pならホスト名を名前の位置に出し、ホスト名を重ねて出さない',
    async (name) => {
      await renderList([{ name, url: 'https://maker.example/' }]);

      const link = page.getByRole('link');
      await expect
        .element(link)
        .toHaveAccessibleName('maker.example (新しいタブで開きます)');
      expect(link.element().textContent.split('maker.example')).toHaveLength(2);
    },
  );

  test('URLの前後の空白を除いてリンクにする', async () => {
    await renderList([
      { name: '個人サイト', url: '  https://maker.example/  ' },
    ]);

    await expect
      .element(page.getByRole('link', { name: /個人サイト/u }))
      .toHaveAttribute('href', 'https://maker.example/');
  });

  test.each([
    ['javascriptスキーム', 'javascript:alert(1)'],
    ['dataスキーム', 'data:text/html,<p>x</p>'],
    ['スキームの無い値', 'maker.example/path'],
    ['//の無いスキーム', 'https:maker.example'],
    ['空文字', ''],
    ['空白だけ', '   '],
    ['2,048文字を超える値', `https://maker.example/${'a'.repeat(2048)}`],
  ])('%sはリンクにしない', async (_name, url) => {
    await renderList([
      { name: '安全なサイト', url: 'https://safe.example/' },
      { name: '危ないサイト', url },
    ]);

    await expect
      .element(page.getByRole('link', { name: /安全なサイト/u }))
      .toBeVisible();
    await expect
      .poll(
        () =>
          page
            .getByRole('list', { name: '外部Webサイト' })
            .getByRole('listitem')
            .elements().length,
      )
      .toBe(1);
    expect(document.body.textContent).not.toContain('危ないサイト');
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
  });

  test('リンクにできる行が1件も無ければ何も描かない', async () => {
    await renderList([{ name: '危ないサイト', url: 'javascript:alert(1)' }]);

    await expect
      .element(page.getByRole('list', { name: '外部Webサイト' }))
      .not.toBeInTheDocument();
  });

  test('同じURLを複数の行に持っていても全て描く', async () => {
    await renderList([
      { name: '一つ目', url: 'https://maker.example/' },
      { name: '二つ目', url: 'https://maker.example/' },
    ]);

    await expect
      .poll(() => page.getByRole('listitem').elements().length)
      .toBe(2);
  });

  test.each(COLOR_SCHEMES)('%sの配色でaxeの違反が0件である', async (scheme) => {
    applyColorScheme(scheme);
    await renderList([
      { name: '個人サイト', url: 'https://maker.example/' },
      { name: null, url: 'https://blog.example/posts' },
    ]);

    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
