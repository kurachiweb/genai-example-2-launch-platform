import { afterEach, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { TooltipProvider } from '../../../lib/components/ui/tooltip/tooltip-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import type { ProductAwardView } from '../../graphql/product-launch.ts';
import { AwardBadgeList } from './award-badge-list.tsx';

const WEEK_LABELS = [
  '2026年第37週(9/7〜9/13)',
  '2026年第38週(9/14〜9/20)',
  '2026年第40週(9/28〜10/4)',
];

const YEAR_LABELS = ['2026年'];

const WEEK: ProductAwardView = {
  kind: 'week',
  count: 3,
  labels: WEEK_LABELS,
};

const YEAR: ProductAwardView = { kind: 'year', count: 1, labels: YEAR_LABELS };

const renderBadges = (awards: readonly ProductAwardView[]) =>
  render(
    <TooltipProvider>
      <div className="p-12">
        <AwardBadgeList awards={awards} />
        <p>受賞の外</p>
      </div>
    </TooltipProvider>,
  );

const badges = () => page.getByRole('button');

afterEach(() => {
  applyColorScheme('light');
});

describe('AwardBadgeList', () => {
  test('種類ごとに1つのバッジを、受け取った順によらずYearを先頭に並べ、2回以上は回数を添える', async () => {
    await renderBadges([WEEK, YEAR]);

    await expect.element(badges().first()).toBeVisible();
    expect(
      badges()
        .elements()
        .map((badge) => badge.textContent),
    ).toEqual(['Product of the Year', 'Product of the Week ×3']);
  });

  test('各バッジはキーボードでフォーカスでき、ツールチップに受賞の週・年を1件1行で示し、読み上げ用の文言では「、」でつなぐ', async () => {
    await renderBadges([WEEK, YEAR]);

    await userEvent.tab();
    await userEvent.tab();

    const week = page.getByRole('button', { name: 'Product of the Week ×3' });
    await expect.element(week).toHaveFocus();
    const tooltip = page.getByRole('tooltip');
    await expect.element(tooltip).toBeInTheDocument();
    for (const label of WEEK_LABELS) {
      await expect.element(tooltip).toHaveTextContent(label);
    }
    const lines = document.querySelectorAll(
      '[data-slot="tooltip-content"] [data-slot="award-label"]',
    );
    expect([...lines].map((line) => line.textContent)).toEqual(WEEK_LABELS);
    await expect
      .element(week)
      .toHaveAccessibleDescription(WEEK_LABELS.join('、'));
    await expect
      .element(page.getByRole('button', { name: 'Product of the Year' }))
      .toHaveAccessibleDescription('2026年');
  });

  test('ゴールドの配色で描く', async () => {
    await renderBadges([YEAR]);

    const badge = badges().first();
    await expect.element(badge).toBeVisible();
    expect(badge.element().classList.contains('bg-gold')).toBe(true);
  });

  test('受賞が無ければ何も描かない', async () => {
    const { container } = await renderBadges([]);

    expect(container.querySelector('ul')).toBeNull();
    expect(badges().elements()).toHaveLength(0);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('ツールチップを開いた状態で、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      await renderBadges([WEEK, YEAR]);
      await userEvent.tab();
      await expect.element(page.getByRole('tooltip')).toBeInTheDocument();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
