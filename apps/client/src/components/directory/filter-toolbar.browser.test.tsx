import { afterEach, describe, expect, test, vi } from 'vitest';
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
import type { DirectoryFilterPatch } from './filter-sheet-draft.ts';
import { FilterToolbar } from './filter-toolbar.tsx';

// 2026-09-17は木曜日
const TODAY = '2026-09-17';
const DESKTOP = { width: 1024, height: 800 } as const;
const MOBILE = { width: 375, height: 800 } as const;

// 画面幅によりCSSで隠した側も見つけて、見えないことを確かめる
const buttonOf = (name: RegExp) =>
  page.getByRole('button', { name, includeHidden: true });
const categoryTrigger = () => buttonOf(/^カテゴリ /);
const periodTrigger = () => buttonOf(/^期間 /);
const sortTrigger = () => buttonOf(/^並び順 /);
const sheetButton = () => buttonOf(/^絞り込み・並び順/);
const sheet = () => page.getByRole('dialog', { name: '絞り込み・並び順' });

async function renderToolbar(
  query: DirectoryQuery,
  onChange: (patch: DirectoryFilterPatch) => void = () => undefined,
) {
  return render(
    <div className="bg-background p-4 text-foreground">
      <FilterToolbar
        query={query}
        categories={DIRECTORY_CATEGORY_FIXTURES}
        categoriesLoading={false}
        businessToday={TODAY}
        onChange={onChange}
      />
    </div>,
  );
}

afterEach(() => {
  applyColorScheme('light');
});

describe('FilterToolbar', () => {
  describe('画面幅が768px以上のとき', () => {
    test('カテゴリ・期間・並び順の選択欄を横に並べ、絞り込みのシートのボタンを出さない', async () => {
      await page.viewport(DESKTOP.width, DESKTOP.height);
      await renderToolbar({});

      await expect.element(categoryTrigger()).toBeVisible();
      await expect.element(periodTrigger()).toBeVisible();
      await expect.element(sortTrigger()).toBeVisible();
      await expect.element(sheetButton()).not.toBeVisible();
      const tops = [categoryTrigger(), periodTrigger(), sortTrigger()].map(
        (trigger) => trigger.element().getBoundingClientRect().top,
      );
      expect(new Set(tops).size).toBe(1);
    });

    test('カテゴリ・期間・並び順は選んだ時点でそれぞれ知らせる', async () => {
      await page.viewport(DESKTOP.width, DESKTOP.height);
      const onChange = vi.fn();
      await renderToolbar({}, onChange);

      await userEvent.click(categoryTrigger());
      await userEvent.click(
        page.getByRole('option', { name: 'デザイン', exact: true }),
      );
      expect(onChange.mock.calls).toStrictEqual([[{ category: 'design' }]]);

      await userEvent.click(periodTrigger());
      await userEvent.click(
        page.getByRole('menuitemradio', { name: '今月', exact: true }),
      );
      expect(onChange.mock.calls.at(-1)).toStrictEqual([
        { from: '2026-09-01', to: '2026-09-30' },
      ]);

      await userEvent.click(sortTrigger());
      await userEvent.click(
        page.getByRole('menuitemradio', {
          name: 'ローンチ日が古い順',
          exact: true,
        }),
      );
      expect(onChange.mock.calls.at(-1)).toStrictEqual([{ sort: 'oldest' }]);
      expect(onChange).toHaveBeenCalledTimes(3);
    });

    test('既定の値から変えている選択欄だけを強調する', async () => {
      await page.viewport(DESKTOP.width, DESKTOP.height);
      await renderToolbar({
        category: 'design',
        from: '2026-09-01',
        to: '2026-09-30',
        sort: 'oldest',
      });

      for (const trigger of [
        categoryTrigger(),
        periodTrigger(),
        sortTrigger(),
      ]) {
        await expect.element(trigger).toHaveAttribute('data-active', 'true');
      }
    });

    test('既定の値の選択欄は強調しない', async () => {
      await page.viewport(DESKTOP.width, DESKTOP.height);
      await renderToolbar({ q: 'ノート' });

      for (const trigger of [
        categoryTrigger(),
        periodTrigger(),
        sortTrigger(),
      ]) {
        await expect.element(trigger).not.toHaveAttribute('data-active');
      }
    });
  });

  describe('画面幅が768px未満のとき', () => {
    test('選択欄を出さず、「絞り込み・並び順」のボタンに変えている項目の数を添える', async () => {
      await page.viewport(MOBILE.width, MOBILE.height);
      await renderToolbar({ category: 'design', sort: 'oldest' });

      await expect.element(sheetButton()).toBeVisible();
      await expect
        .element(sheetButton())
        .toHaveAccessibleName('絞り込み・並び順 変更中の項目 2');
      await expect.element(categoryTrigger()).not.toBeVisible();
      await expect.element(periodTrigger()).not.toBeVisible();
      await expect.element(sortTrigger()).not.toBeVisible();
    });

    test('シートで選んだ条件を「適用」でまとめて知らせる', async () => {
      await page.viewport(MOBILE.width, MOBILE.height);
      const onChange = vi.fn();
      await renderToolbar({}, onChange);

      await userEvent.click(sheetButton());
      await userEvent.click(
        sheet().getByRole('option', { name: 'AI', exact: true }),
      );
      await userEvent.click(
        sheet().getByRole('radio', { name: '昨日', exact: true }),
      );
      await userEvent.click(
        sheet().getByRole('radio', { name: 'Upvote数が多い順', exact: true }),
      );
      expect(onChange).not.toHaveBeenCalled();

      await userEvent.click(
        sheet().getByRole('button', { name: '適用', exact: true }),
      );

      expect(onChange.mock.calls).toStrictEqual([
        [
          {
            category: 'ai',
            from: '2026-09-16',
            to: '2026-09-16',
            sort: 'upvotes',
          },
        ],
      ]);
    });

    test('横にはみ出さない', async () => {
      await page.viewport(320, MOBILE.height);
      await renderToolbar({ category: 'design', from: '2026-09-02' });

      await expect.element(sheetButton()).toBeVisible();
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
        document.documentElement.clientWidth,
      );
    });
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test.each([
      ['768px以上', DESKTOP],
      ['768px未満', MOBILE],
    ])(
      '%sの、既定と変更中の選択欄で、アクセシビリティの検査の違反が0件',
      async (_label, viewport) => {
        await page.viewport(viewport.width, viewport.height);
        applyColorScheme(scheme);
        const { container } = await renderToolbar({
          category: 'design',
          sort: 'oldest',
        });

        expect(await runAxe(container)).toStrictEqual([]);
      },
    );
  });
});
