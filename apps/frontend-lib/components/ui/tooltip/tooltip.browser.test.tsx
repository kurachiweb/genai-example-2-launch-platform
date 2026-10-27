import { afterEach, describe, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../../styles/base.css';
import { runAxe } from '../../../test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../test/computed-style.ts';
import {
  emulateReducedMotion,
  REDUCED_MOTION_PREFERENCES,
} from '../../../test/reduced-motion.ts';
import { Button } from '../button/button.tsx';
import { Tooltip } from './tooltip.tsx';
import { TooltipContent } from './tooltip-content.tsx';
import { TooltipProvider } from './tooltip-provider.tsx';
import { TooltipTrigger } from './tooltip-trigger.tsx';

const AWARD_WEEKS = '2026年第37週・第38週・第40週に受賞';

function AwardTooltip() {
  return (
    <TooltipProvider>
      <div className="flex flex-col items-start gap-8 p-12">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline">Product of the Week ×3</Button>
          </TooltipTrigger>
          <TooltipContent>{AWARD_WEEKS}</TooltipContent>
        </Tooltip>
        <p>受賞の一覧</p>
      </div>
    </TooltipProvider>
  );
}

const trigger = () =>
  page.getByRole('button', { name: 'Product of the Week ×3' });
const tooltip = () => page.getByRole('tooltip');
const outside = () => page.getByText('受賞の一覧');

afterEach(async () => {
  applyColorScheme('light');
  await emulateReducedMotion('no-preference');
});

describe('Tooltip', () => {
  test('キーボードでフォーカスすると待たずに表示し、内容を開いた元の要素の説明として支援技術へ伝える', async () => {
    await render(<AwardTooltip />);

    await userEvent.tab();

    await expect.element(tooltip()).toHaveTextContent(AWARD_WEEKS);
    await expect.element(trigger()).toHaveAccessibleDescription(AWARD_WEEKS);
  });

  test.each(REDUCED_MOTION_PREFERENCES)(
    '視差効果の設定が%sのとき、Escapeで閉じるとツールチップが取り除かれ、フォーカスは開いた元の要素に残る',
    async (preference) => {
      await emulateReducedMotion(preference);
      await render(<AwardTooltip />);
      await userEvent.tab();
      await expect.element(tooltip()).toBeInTheDocument();

      await userEvent.keyboard('{Escape}');

      await expect.element(tooltip()).not.toBeInTheDocument();
      await expect.element(trigger()).toHaveFocus();
    },
  );

  test('ポインターを重ねると表示し、外すと閉じる', async () => {
    await render(<AwardTooltip />);

    await userEvent.hover(trigger());
    await expect.element(tooltip()).toHaveTextContent(AWARD_WEEKS);
    // 開いた元の要素から内容へ向かう途中の猶予の範囲では閉じないため、範囲の外でもう一度ポインターを動かす
    await userEvent.hover(outside(), { position: { x: 1, y: 1 } });
    await userEvent.hover(outside(), { position: { x: 8, y: 8 } });

    await expect.element(tooltip()).not.toBeInTheDocument();
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('表示したツールチップで、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      await render(<AwardTooltip />);
      await userEvent.tab();
      await expect.element(tooltip()).toBeInTheDocument();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
