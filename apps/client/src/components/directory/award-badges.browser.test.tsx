import { afterEach, describe, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { TooltipProvider } from '../../../lib/components/ui/tooltip/tooltip-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { AwardBadges } from './award-badges.tsx';
import { WEEK_AWARD, YEAR_AWARD } from './directory-item-fixtures.ts';
import type { DirectoryAwardData } from './directory-item-types.ts';

const renderBadges = (awards: readonly DirectoryAwardData[]) =>
  render(
    <TooltipProvider>
      <div className="bg-card p-12 text-card-foreground">
        <AwardBadges awards={awards} />
      </div>
    </TooltipProvider>,
  );

const badges = () => page.getByRole('button');

afterEach(() => {
  applyColorScheme('light');
});

describe('AwardBadges', () => {
  test('賞の種類ごとに1つのゴールドのバッジを、受け取った順によらずYearを先頭に並べ、複数回は「×3」を添える', async () => {
    await renderBadges([WEEK_AWARD, YEAR_AWARD]);

    await expect.element(badges().first()).toBeVisible();
    expect(
      badges()
        .elements()
        .map((badge) => badge.textContent),
    ).toStrictEqual(['Product of the Year', 'Product of the Week ×3']);
    for (const badge of badges().elements()) {
      expect(badge.classList.contains('bg-gold')).toBe(true);
    }
  });

  test('受賞した週・年をツールチップで示し、読み上げ用の説明では「、」でつなぐ', async () => {
    await renderBadges([YEAR_AWARD, WEEK_AWARD]);

    const week = page.getByRole('button', { name: 'Product of the Week ×3' });
    await userEvent.hover(week);

    const tooltip = page.getByRole('tooltip');
    await expect.element(tooltip).toBeInTheDocument();
    for (const label of WEEK_AWARD.labels) {
      await expect.element(tooltip).toHaveTextContent(label);
    }
    await expect
      .element(page.getByRole('button', { name: 'Product of the Year' }))
      .toHaveAccessibleDescription('2026年');
  });

  test('受賞が無ければ何も描かない', async () => {
    const { container } = await renderBadges([]);

    expect(container.querySelector('ul')).toBeNull();
    expect(badges().elements()).toHaveLength(0);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('ツールチップを開いた状態で、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      await renderBadges([WEEK_AWARD, YEAR_AWARD]);
      await userEvent.tab();
      await expect.element(page.getByRole('tooltip')).toBeInTheDocument();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
