import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { BYE_WIN, EARLY_WIN, VICTORY_WIN } from './directory-item-fixtures.ts';
import type { DirectoryWinData } from './directory-item-types.ts';
import { WinSummary } from './win-summary.tsx';

const NOW = new Date('2026-11-10T08:00:00.000Z');

const renderSummary = (win: DirectoryWinData) =>
  render(
    <DisplayPreferencesProvider
      initial={{ timeZone: 'Asia/Tokyo', locale: 'ja-JP' }}
    >
      <div className="bg-card p-4 text-card-foreground">
        <h3>Pitch Notes</h3>
        <WinSummary win={win} />
      </div>
    </DisplayPreferencesProvider>,
  );

const heading = () => page.getByRole('heading', { name: '予選勝利' });

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
});

afterEach(() => {
  vi.useRealTimers();
  applyColorScheme('light');
});

describe('WinSummary', () => {
  test('勝敗の付いた勝利は、見出し「予選勝利」・今年のローンチ日を年を省いて・自身のUpvote数を「1,234票」で示し、票数の前に支援技術にだけ「Upvote数」を伝える', async () => {
    const { container } = await renderSummary(VICTORY_WIN);

    await expect.element(heading()).toBeVisible();
    const time = container.querySelector('time');
    expect(time?.getAttribute('datetime')).toBe('2026-09-15');
    expect(time?.textContent).toBe('9月15日');
    const votes = page.getByText(/1,234票/u);
    await expect.element(votes).toBeVisible();
    expect(votes.element().textContent).toBe('Upvote数1,234票');
    const prefix = votes.element().querySelector('.sr-only');
    expect(prefix?.textContent).toBe('Upvote数');
    expect(page.getByText('不戦勝').elements()).toHaveLength(0);
  });

  test('対戦相手がいない不戦勝は、Upvote数を出さずに「不戦勝」と「対戦相手がいないため」を示す', async () => {
    const { container } = await renderSummary(BYE_WIN);

    await expect.element(heading()).toBeVisible();
    await expect
      .element(page.getByText('不戦勝', { exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByText('対戦相手がいないため', { exact: true }))
      .toBeVisible();
    expect(container.textContent).not.toMatch(/票/u);
    expect(container.querySelector('time')?.textContent).toBe('9月16日');
  });

  test('マッチ中の相手の退会等による勝利は、「不戦勝」と確定時点の自身のUpvote数を示し、今年でないローンチ日は年を付ける', async () => {
    const { container } = await renderSummary(EARLY_WIN);

    await expect
      .element(page.getByText('不戦勝', { exact: true }))
      .toBeVisible();
    const settled = page.getByText(/^確定時点で/u);
    await expect.element(settled).toBeVisible();
    expect(settled.element().textContent).toBe('確定時点でUpvote数1,234票');
    expect(settled.element().querySelector('.sr-only')?.textContent).toBe(
      'Upvote数',
    );
    expect(page.getByText('対戦相手がいないため').elements()).toHaveLength(0);
    const time = container.querySelector('time');
    expect(time?.getAttribute('datetime')).toBe('2025-12-01');
    expect(time?.textContent).toBe('2025年12月1日');
  });

  test('対戦相手の情報と比率のバー、最終Upvote時間の特別な文言を出さない', async () => {
    const { container } = await renderSummary(VICTORY_WIN);

    await expect.element(heading()).toBeVisible();
    expect(container.textContent).not.toMatch(/vs|VS|最終Upvote|対戦相手/u);
    expect(page.getByRole('img').elements()).toHaveLength(0);
    expect(page.getByRole('progressbar').elements()).toHaveLength(0);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test.each([
      ['勝敗の付いた勝利', VICTORY_WIN],
      ['対戦相手がいない不戦勝', BYE_WIN],
      ['確定時点の票数の不戦勝', EARLY_WIN],
    ] as const)(
      '%sで、アクセシビリティの検査の違反が0件',
      async (_name, win) => {
        applyColorScheme(scheme);
        const { container } = await renderSummary(win);
        await expect.element(heading()).toBeVisible();

        expect(await runAxe(container)).toStrictEqual([]);
      },
    );
  });
});
