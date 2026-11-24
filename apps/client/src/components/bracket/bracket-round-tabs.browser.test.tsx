import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
  outlineOf,
  ringOutline,
} from '../../../lib/test/computed-style.ts';
import { pressKeyUntilFocusMoves } from '../../../lib/test/keyboard.ts';
import { renderInMatchFrame } from '../match/match-testing.tsx';
import {
  bracketMatchOf,
  bracketNodeOf,
  bracketRoundOf,
  IN_PROGRESS_ROUNDS,
  playedSlotOf,
} from './bracket-fixtures.ts';
import { BracketRoundTabs } from './bracket-round-tabs.tsx';
import type { BracketViewRound } from './bracket-view-props.ts';

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const renderTabs = async (rounds: readonly BracketViewRound[]) => {
  await renderInMatchFrame(<BracketRoundTabs rounds={rounds} />, {
    width: 360,
  });
};

const tabList = () => page.getByRole('tablist', { name: 'ラウンド' });

const tab = (name: string) => page.getByRole('tab', { name, exact: true });

const panel = () => page.getByRole('tabpanel');

const finishedRound = (round: number, name: string): BracketViewRound =>
  bracketRoundOf(round, name, `2026-11-1${String(round)}`, [
    bracketNodeOf(
      1,
      bracketMatchOf(round, {
        round,
        date: `2026-11-1${String(round)}`,
        phase: 'FINISHED',
        decision: 'VOTES',
      }),
      [playedSlotOf(1, { result: 'WON' }), playedSlotOf(2, { result: 'LOST' })],
    ),
  ]);

afterEach(() => {
  applyColorScheme('light');
});

describe('BracketRoundTabs', () => {
  test('ラウンド名のタブを「ラウンド」の一覧に並べ、既定で進行中のラウンドを選ぶ', async () => {
    await renderTabs(IN_PROGRESS_ROUNDS);

    await expect.element(tabList()).toBeVisible();
    expect(
      page
        .getByRole('tab')
        .elements()
        .map((element) => element.textContent),
    ).toStrictEqual(['1回戦', '準決勝', '決勝']);
    await expect
      .element(tab('準決勝'))
      .toHaveAttribute('aria-selected', 'true');
    await expect.element(panel()).toHaveAccessibleName('準決勝');
    await expect
      .element(panel().getByRole('heading', { level: 2 }))
      .toHaveTextContent('準決勝(11月11日)');
    expect(
      panel()
        .getByRole('heading', { level: 3 })
        .elements()
        .map((heading) => heading.textContent),
    ).toStrictEqual(['準決勝第1試合', '準決勝第2試合']);
  });

  test('すべてのマッチの結果が確定していれば、既定で最後のラウンドを選ぶ', async () => {
    await renderTabs([finishedRound(1, '準決勝'), finishedRound(2, '決勝')]);

    await expect.element(tab('決勝')).toHaveAttribute('aria-selected', 'true');
  });

  test('ラウンドが無ければ何も描かない', async () => {
    await renderTabs([]);

    expect(page.getByRole('tablist').elements()).toHaveLength(0);
    expect(page.getByRole('tabpanel').elements()).toHaveLength(0);
  });

  test('キーボードでタブを切り替え、選んだラウンドのマッチへ進める', async () => {
    await renderTabs(IN_PROGRESS_ROUNDS);

    await userEvent.tab();
    await expect.element(tab('準決勝')).toHaveFocus();

    await pressKeyUntilFocusMoves('ArrowLeft');
    await expect.element(tab('1回戦')).toHaveFocus();
    await expect.element(tab('1回戦')).toHaveAttribute('aria-selected', 'true');
    await expect.element(panel()).toHaveAccessibleName('1回戦');

    await pressKeyUntilFocusMoves('End');
    await expect.element(tab('決勝')).toHaveAttribute('aria-selected', 'true');

    await pressKeyUntilFocusMoves('Home');
    await expect.element(tab('1回戦')).toHaveAttribute('aria-selected', 'true');

    await userEvent.tab();
    await expect.element(panel()).toHaveFocus();

    await userEvent.tab();
    await expect
      .element(page.getByRole('link', { name: 'Bracket Product 3' }))
      .toHaveFocus();
  });

  test('キーボードで移ったラウンドの内容のパネルのフォーカスを、リングの色の輪郭で示す', async () => {
    await renderTabs(IN_PROGRESS_ROUNDS);

    await userEvent.tab();
    await expect.element(tab('準決勝')).toHaveFocus();
    await userEvent.tab();

    await expect.element(panel()).toHaveFocus();
    await expect
      .poll(() => outlineOf(panel().element()))
      .toStrictEqual(ringOutline());
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('アクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    await renderTabs(IN_PROGRESS_ROUNDS);

    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
