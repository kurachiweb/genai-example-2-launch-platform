import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import type { DirectoryQuery } from '../../../common-lib/directory/directory-query-rules.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { DIRECTORY_CATEGORY_FIXTURES } from './category-picker-fixtures.ts';
import { FilterSheet } from './filter-sheet.tsx';
import type { DirectoryFilterPatch } from './filter-sheet-draft.ts';

// 2026-09-17は木曜日
const TODAY = '2026-09-17';
const SHEET_DESCRIPTION =
  'カテゴリ・ローンチ期間・並び順を選び、「適用」で一覧に反映します。';
const RELEVANCE_REASON = '検索キーワードを入力すると選べます';

const openButton = () =>
  page.getByRole('button', { name: /^絞り込み・並び順/ });
const sheet = () => page.getByRole('dialog', { name: '絞り込み・並び順' });
const categoryOption = (name: string) =>
  sheet().getByRole('option', { name, exact: true });
const radio = (name: string) =>
  sheet().getByRole('radio', { name, exact: true });
const applyButton = () =>
  sheet().getByRole('button', { name: '適用', exact: true });
const resetButton = () =>
  sheet().getByRole('button', { name: 'リセット', exact: true });
const fromInput = () => sheet().getByLabelText('開始日', { exact: true });
const toInput = () => sheet().getByLabelText('終了日', { exact: true });

interface RenderOptions {
  readonly query?: DirectoryQuery;
  readonly loading?: boolean;
  readonly onChange?: (patch: DirectoryFilterPatch) => void;
}

async function renderSheet({
  query = {},
  loading = false,
  onChange = () => undefined,
}: RenderOptions = {}) {
  return render(
    <div className="bg-background p-4 text-foreground">
      <FilterSheet
        query={query}
        categories={DIRECTORY_CATEGORY_FIXTURES}
        categoriesLoading={loading}
        businessToday={TODAY}
        onChange={onChange}
        onWideScreenClose={() => undefined}
      />
    </div>,
  );
}

async function openSheet(): Promise<void> {
  await userEvent.click(openButton());
  await expect.element(sheet()).toBeInTheDocument();
}

beforeEach(async () => {
  await page.viewport(375, 800);
});

afterEach(() => {
  applyColorScheme('light');
});

describe('FilterSheet', () => {
  test.each([
    [{}, '絞り込み・並び順'],
    [{ q: 'ノート' }, '絞り込み・並び順'],
    [{ category: 'design' }, '絞り込み・並び順 変更中の項目 1'],
    [
      { category: 'design', from: '2026-09-01', sort: 'oldest' },
      '絞り込み・並び順 変更中の項目 3',
    ],
  ] satisfies [DirectoryQuery, string][])(
    'ボタンに既定の値から変えている項目の数を添え、支援技術には数の前に「変更中の項目」を伝える(%o)',
    async (query, name) => {
      await renderSheet({ query });

      await expect.element(openButton()).toHaveAccessibleName(name);
    },
  );

  test('下部のシートに見出し・説明・区画の見出しを置き、適用中の条件を下書きの初期の値にする', async () => {
    await renderSheet({
      query: {
        q: 'ノート',
        category: 'ai',
        from: '2026-09-14',
        to: '2026-09-20',
        sort: 'upvotes',
      },
    });

    await openSheet();

    await expect
      .element(sheet())
      .toHaveAccessibleDescription(SHEET_DESCRIPTION);
    for (const name of ['カテゴリ', '期間', '並び順']) {
      await expect
        .element(sheet().getByRole('heading', { name, exact: true }))
        .toBeInTheDocument();
    }
    await expect
      .element(categoryOption('AI'))
      .toHaveAttribute('aria-selected', 'true');
    await expect.element(radio('今週')).toBeChecked();
    await expect.element(radio('Upvote数が多い順')).toBeChecked();
    // 開く演出の移動が終わってから、シートが画面の下端に接していることを確かめる
    await expect
      .poll(() => sheet().element().getBoundingClientRect().bottom)
      .toBeCloseTo(window.innerHeight, 0);
  });

  test('シートで選んだ条件は「適用」までは知らせず、「適用」で4つの項目をまとめて知らせてシートを閉じる', async () => {
    const onChange = vi.fn();
    await renderSheet({ onChange });

    await openSheet();
    await userEvent.click(categoryOption('デザイン'));
    await userEvent.click(radio('今月'));
    await userEvent.click(radio('ローンチ日が古い順'));
    expect(onChange).not.toHaveBeenCalled();

    await userEvent.click(applyButton());

    expect(onChange.mock.calls).toStrictEqual([
      [
        {
          category: 'design',
          from: '2026-09-01',
          to: '2026-09-30',
          sort: 'oldest',
        },
      ],
    ]);
    await expect.element(sheet()).not.toBeInTheDocument();
    await expect.element(openButton()).toHaveFocus();
  });

  test('何も変えずに「適用」を押すと、知らせずに閉じる', async () => {
    const onChange = vi.fn();
    await renderSheet({ query: { category: 'ai' }, onChange });

    await openSheet();
    await userEvent.click(applyButton());

    expect(onChange).not.toHaveBeenCalled();
    await expect.element(sheet()).not.toBeInTheDocument();
  });

  test('「閉じる」で閉じると下書きを捨て、開き直すと適用中の条件に戻す', async () => {
    const onChange = vi.fn();
    await renderSheet({ query: { category: 'ai' }, onChange });

    await openSheet();
    await userEvent.click(categoryOption('デザイン'));
    await userEvent.click(sheet().getByRole('button', { name: '閉じる' }));
    await expect.element(sheet()).not.toBeInTheDocument();
    await openSheet();

    expect(onChange).not.toHaveBeenCalled();
    await expect
      .element(categoryOption('AI'))
      .toHaveAttribute('aria-selected', 'true');
  });

  test('「リセット」は下書きだけを既定の値に戻し、「適用」で既定の条件を知らせる', async () => {
    const onChange = vi.fn();
    await renderSheet({
      query: { category: 'ai', from: '2026-09-01', sort: 'oldest' },
      onChange,
    });

    await openSheet();
    await userEvent.click(resetButton());

    expect(onChange).not.toHaveBeenCalled();
    await expect
      .element(categoryOption('全て'))
      .toHaveAttribute('aria-selected', 'true');
    await expect.element(radio('全期間')).toBeChecked();
    await expect.element(radio('ローンチ日が新しい順')).toBeChecked();

    await userEvent.click(applyButton());

    expect(onChange.mock.calls).toStrictEqual([
      [{ category: undefined, from: undefined, to: undefined, sort: 'newest' }],
    ]);
  });

  test('検索語が無い間は「関連度」を選べず理由を併記し、検索語があれば選べる', async () => {
    const { rerender } = await renderSheet();

    await openSheet();

    await expect.element(radio('関連度')).toBeDisabled();
    await expect
      .element(radio('関連度'))
      .toHaveAccessibleDescription(RELEVANCE_REASON);

    await userEvent.keyboard('{Escape}');
    await rerender(
      <div className="bg-background p-4 text-foreground">
        <FilterSheet
          query={{ q: 'ノート' }}
          categories={DIRECTORY_CATEGORY_FIXTURES}
          categoriesLoading={false}
          businessToday={TODAY}
          onChange={() => undefined}
          onWideScreenClose={() => undefined}
        />
      </div>,
    );
    await openSheet();

    await expect.element(radio('関連度')).toBeEnabled();
    await expect.element(radio('関連度')).toBeChecked();
    await expect
      .element(sheet().getByText(RELEVANCE_REASON))
      .not.toBeInTheDocument();
  });

  test('「期間を指定…」はシートの中に日付の入力を出し、適用できる期間になるまで「適用」を無効にする', async () => {
    const onChange = vi.fn();
    await renderSheet({ onChange });

    await openSheet();
    await userEvent.click(radio('期間を指定…'));

    await expect.element(fromInput()).toBeVisible();
    await expect.element(applyButton()).toBeDisabled();

    await userEvent.fill(fromInput(), '2026-09-18');
    await expect.element(applyButton()).toBeDisabled();

    await userEvent.fill(fromInput(), '2026-09-01');
    await expect.element(applyButton()).toBeEnabled();
    await userEvent.click(applyButton());

    expect(onChange.mock.calls).toStrictEqual([
      [
        {
          category: undefined,
          from: '2026-09-01',
          to: undefined,
          sort: 'newest',
        },
      ],
    ]);
  });

  test('プリセットと一致しない適用中の期間は「期間を指定…」を選んだ状態で両端を入れて開く', async () => {
    await renderSheet({ query: { from: '2026-09-02', to: '2026-09-10' } });

    await openSheet();

    await expect.element(radio('期間を指定…')).toBeChecked();
    await expect.element(fromInput()).toHaveValue('2026-09-02');
    await expect.element(toInput()).toHaveValue('2026-09-10');
  });

  test('カテゴリの読み込み中は、カテゴリの区画に「読み込み中…」を示す', async () => {
    await renderSheet({ loading: true });

    await openSheet();

    await expect
      .element(sheet().getByText('読み込み中…', { exact: true }))
      .toBeVisible();
    await expect.element(sheet().getByRole('combobox')).not.toBeInTheDocument();
  });

  test('開くとソフトウェアキーボードを出さないようフォーカスをシートの見出しへ移し、Tabで最初の操作(カテゴリの絞り込みの欄)へ進む', async () => {
    await renderSheet();

    await openSheet();

    await expect
      .element(
        sheet().getByRole('heading', { name: '絞り込み・並び順', level: 2 }),
      )
      .toHaveFocus();

    await userEvent.tab();

    await expect
      .element(sheet().getByRole('combobox', { name: 'カテゴリを絞り込む' }))
      .toHaveFocus();
  });

  test('Escapeで閉じるとボタンへフォーカスを戻す', async () => {
    await renderSheet();

    await openSheet();
    await userEvent.keyboard('{Escape}');

    await expect.element(sheet()).not.toBeInTheDocument();
    await expect.element(openButton()).toHaveFocus();
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('ボタンと、開いたシート(期間を指定と関連度の無効を含む)で、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await renderSheet({
        query: { category: 'ai', from: '2026-09-02' },
      });

      expect(await runAxe(container)).toStrictEqual([]);

      await openSheet();
      expect(await runAxe(sheet().element())).toStrictEqual([]);
    });
  });
});
