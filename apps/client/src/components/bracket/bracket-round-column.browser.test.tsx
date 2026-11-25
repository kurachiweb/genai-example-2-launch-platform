import { afterEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { renderInMatchFrame } from '../match/match-testing.tsx';
import {
  IN_PROGRESS_FIRST_ROUND,
  IN_PROGRESS_SEMIFINAL,
} from './bracket-fixtures.ts';
import { BracketRoundColumn } from './bracket-round-column.tsx';

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

afterEach(() => {
  applyColorScheme('light');
});

describe('BracketRoundColumn', () => {
  test('ラウンド名と実施日の見出しで区画に名前を付け、実施日をtime要素で示す', async () => {
    await renderInMatchFrame(
      <BracketRoundColumn round={IN_PROGRESS_SEMIFINAL} />,
      {
        width: 320,
      },
    );

    const column = page.getByRole('region', { name: '準決勝(11月11日)' });
    await expect.element(column).toBeVisible();
    await expect
      .element(page.getByRole('heading', { level: 2 }))
      .toHaveTextContent('準決勝(11月11日)');
    expect(document.querySelector('h2 time')?.getAttribute('datetime')).toBe(
      '2026-11-11',
    );
  });

  test('ラウンドのマッチを位置の順に並べる', async () => {
    await renderInMatchFrame(
      <BracketRoundColumn round={IN_PROGRESS_FIRST_ROUND} />,
      {
        width: 320,
      },
    );

    expect(
      page
        .getByRole('heading', { level: 3 })
        .elements()
        .map((heading) => heading.textContent),
    ).toStrictEqual(['1回戦第1試合', '1回戦第2試合']);
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('アクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    await renderInMatchFrame(
      <BracketRoundColumn round={IN_PROGRESS_SEMIFINAL} />,
      {
        width: 320,
      },
    );

    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
