import { afterEach, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { PlaceholderHome } from './placeholder-home.tsx';

afterEach(() => {
  applyColorScheme('light');
});

describe('PlaceholderHome', () => {
  test('管理画面の名前の見出しと、準備中であることを表示する', async () => {
    await render(<PlaceholderHome />);

    await expect
      .element(page.getByRole('heading', { level: 1 }))
      .toHaveTextContent('Launch Stadium管理');
    await expect
      .element(page.getByText('トップページは準備中です。'))
      .toBeVisible();
  });

  test.each(COLOR_SCHEMES)(
    '%sの配色で検査の補助の違反が無い',
    async (scheme) => {
      applyColorScheme(scheme);
      const { container } = await render(<PlaceholderHome />);

      expect(await runAxe(container)).toStrictEqual([]);
    },
  );
});
