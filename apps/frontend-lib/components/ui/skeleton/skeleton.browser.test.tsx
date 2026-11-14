import { afterEach, describe, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../../styles/base.css';
import { runAxe } from '../../../test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
  tokenColorOf,
} from '../../../test/computed-style.ts';
import { emulateReducedMotion } from '../../../test/reduced-motion.ts';
import { Skeleton } from './skeleton.tsx';

afterEach(async () => {
  applyColorScheme('light');
  await emulateReducedMotion('no-preference');
});

describe('Skeleton', () => {
  test.each(COLOR_SCHEMES)(
    '配色が%sのとき、視差効果を減らす設定でも、背景と異なるアクセントの色の面で読み込み中の場所を示す',
    async (scheme) => {
      applyColorScheme(scheme);
      await emulateReducedMotion('reduce');
      await render(<Skeleton data-testid="skeleton" className="h-4 w-32" />);

      const { backgroundColor, animationIterationCount } = getComputedStyle(
        page.getByTestId('skeleton').element(),
      );

      expect(animationIterationCount).toBe('1');
      expect(backgroundColor).toBe(tokenColorOf('accent'));
      expect(backgroundColor).not.toBe(tokenColorOf('background'));
    },
  );

  test('Tabの移動先にならない', async () => {
    await render(
      <>
        <Skeleton className="h-4 w-32" />
        <button type="button">再読み込み</button>
      </>,
    );

    await userEvent.tab();

    await expect
      .element(page.getByRole('button', { name: '再読み込み' }))
      .toHaveFocus();
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(
        <div className="flex flex-col gap-2 p-4">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>,
      );

      expect(await runAxe(container)).toStrictEqual([]);
    });
  });
});
