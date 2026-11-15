import { afterEach, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { ResultCount, type ResultCountProps } from './result-count.tsx';

const renderCount = (props: ResultCountProps) =>
  render(
    <DisplayPreferencesProvider
      initial={{ timeZone: 'Asia/Tokyo', locale: 'ja-JP' }}
    >
      <main className="bg-background p-4 text-foreground">
        <ResultCount {...props} />
      </main>
    </DisplayPreferencesProvider>,
  );

const countElement = (): HTMLElement => {
  const element = document.querySelector<HTMLElement>('[aria-live]');
  if (element === null) {
    throw new Error('件数の欄が描かれていません。');
  }
  return element;
};

afterEach(() => {
  applyColorScheme('light');
});

describe('ResultCount', () => {
  test('複数のページにまたがる件数は、総件数と表示中の範囲を3桁区切りで「1,234件中21〜40件」と示す', async () => {
    await renderCount({
      totalCount: 1234,
      page: 2,
      pageCount: 62,
      loading: false,
    });

    await expect
      .element(page.getByText('1,234件中21〜40件', { exact: true }))
      .toBeVisible();
  });

  test('最後のページの範囲は総件数で終わる', async () => {
    await renderCount({
      totalCount: 1234,
      page: 62,
      pageCount: 62,
      loading: false,
    });

    await expect
      .element(page.getByText('1,234件中1,221〜1,234件', { exact: true }))
      .toBeVisible();
  });

  test('1ページに収まる件数は「3件」と総件数だけを示す', async () => {
    await renderCount({ totalCount: 3, page: 1, pageCount: 1, loading: false });

    await expect.element(page.getByText('3件', { exact: true })).toBeVisible();
    expect(countElement().textContent).toBe('3件');
  });

  test('ちょうど1ページ分の20件も「20件」と示す', async () => {
    await renderCount({
      totalCount: 20,
      page: 1,
      pageCount: 1,
      loading: false,
    });

    expect(countElement().textContent).toBe('20件');
  });

  test('条件の変更の後の再読み込み中は「読み込み中…」とし、件数の変化を支援技術に控えめに伝える', async () => {
    await renderCount({
      totalCount: 1234,
      page: 2,
      pageCount: 62,
      loading: true,
    });

    await expect
      .element(page.getByText('読み込み中…', { exact: true }))
      .toBeVisible();
    expect(page.getByText(/件中/u).elements()).toHaveLength(0);
    expect(countElement().getAttribute('aria-live')).toBe('polite');
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test.each([
      ['範囲を示す', false],
      ['読み込み中の', true],
    ] as const)(
      '%s件数の欄のアクセシビリティの検査の違反が0件',
      async (_name, loading) => {
        applyColorScheme(scheme);
        await renderCount({
          totalCount: 1234,
          page: 2,
          pageCount: 62,
          loading,
        });

        await expect.element(page.getByText(/件|読み込み中/u)).toBeVisible();
        expect(await runAxe(document.body)).toStrictEqual([]);
      },
    );
  });
});
