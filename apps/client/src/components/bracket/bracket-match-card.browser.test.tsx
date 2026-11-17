import { afterEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { renderInMatchFrame } from '../match/match-testing.tsx';
import { BracketMatchCard } from './bracket-match-card.tsx';
import {
  bracketMatchOf,
  bracketNodeOf,
  bracketProductOf,
  EMPTY_BRACKET_SLOT,
  feedSlotOf,
  playedSlotOf,
} from './bracket-fixtures.ts';
import type { BracketViewNode } from './bracket-view-props.ts';

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const renderCard = async (node: BracketViewNode, roundName = '準々決勝') => {
  await renderInMatchFrame(
    <BracketMatchCard roundName={roundName} node={node} />,
    {
      width: 360,
    },
  );
};

const card = () => page.getByRole('article');

const sideOf = (index: number) => page.getByRole('listitem').nth(index);

afterEach(() => {
  applyColorScheme('light');
});

describe('BracketMatchCard', () => {
  test('ラウンド名と位置の見出しでマッチの記事に名前を付け、状態・シード・プロダクト・Upvote数・勝敗を示す', async () => {
    await renderCard(
      bracketNodeOf(
        2,
        bracketMatchOf(1, { phase: 'FINISHED', decision: 'VOTES' }),
        [
          playedSlotOf(3, { seed: 3, upvoteCount: 1234, result: 'WON' }),
          playedSlotOf(9, { upvoteCount: 9, result: 'LOST' }),
        ],
      ),
    );

    await expect.element(card()).toHaveAccessibleName('準々決勝第2試合');
    await expect
      .element(page.getByRole('heading', { level: 3, name: '準々決勝第2試合' }))
      .toBeVisible();
    await expect
      .element(card().getByText('確定', { exact: true }))
      .toBeVisible();
    await expect
      .element(sideOf(0))
      .toHaveTextContent(/^シード3.?Bracket Product 3Upvote数1,234勝利$/u);
    await expect
      .element(sideOf(1))
      .toHaveTextContent(/^vs.?Bracket Product 9Upvote数9敗北$/u);
    await expect
      .element(page.getByText('Upvote数').first())
      .toHaveClass('sr-only');
  });

  test('掲載されているプロダクトの名称だけをプロダクト詳細へのリンクにする', async () => {
    await renderCard(
      bracketNodeOf(1, bracketMatchOf(1, { phase: 'LIVE' }), [
        playedSlotOf(1),
        playedSlotOf(2, { product: bracketProductOf(2, { listed: false }) }),
      ]),
    );

    await expect
      .element(page.getByRole('link', { name: 'Bracket Product 1' }))
      .toHaveAttribute('href', '/p/bracket-product-1');
    await expect.element(page.getByText('Bracket Product 2')).toBeVisible();
    expect(
      page.getByRole('link', { name: 'Bracket Product 2' }).elements(),
    ).toHaveLength(0);
  });

  test.each([
    ['SCHEDULED', '予定'],
    ['LIVE', 'マッチ中'],
    ['TALLYING', '結果を集計しています'],
    ['FINISHED', '確定'],
  ] as const)('マッチの状態%sを「%s」と示す', async (phase, label) => {
    await renderCard(
      bracketNodeOf(1, bracketMatchOf(1, { phase }), [
        playedSlotOf(1),
        playedSlotOf(2),
      ]),
    );

    await expect
      .element(card().getByText(label, { exact: true }))
      .toBeVisible();
  });

  test('両者が敗北したマッチは両側に「両者敗北」を示す', async () => {
    await renderCard(
      bracketNodeOf(
        1,
        bracketMatchOf(1, { phase: 'FINISHED', decision: 'NO_VOTES' }),
        [
          playedSlotOf(1, { result: 'LOST' }),
          playedSlotOf(2, { result: 'LOST' }),
        ],
      ),
    );

    expect(page.getByText('両者敗北', { exact: true }).elements()).toHaveLength(
      2,
    );
    expect(page.getByText('敗北', { exact: true }).elements()).toHaveLength(0);
  });

  test.each(['BYE', 'WALKOVER'] as const)(
    '結果%sの側は「不戦勝」、相手のいない側は「対戦相手なし」を示す',
    async (result) => {
      await renderCard(
        bracketNodeOf(
          1,
          bracketMatchOf(1, { phase: 'FINISHED', decision: 'BYE' }),
          [playedSlotOf(2, { seed: 2, result }), EMPTY_BRACKET_SLOT],
        ),
      );

      await expect
        .element(sideOf(0))
        .toHaveTextContent(/^シード2.?Bracket Product 2Upvote数0不戦勝$/u);
      await expect.element(sideOf(1)).toHaveTextContent('vs対戦相手なし');
    },
  );

  test('予定を作っていない位置は、どこから勝ち上がる枠かを示し、Upvote数と勝敗を出さない', async () => {
    await renderCard(
      bracketNodeOf(3, null, [
        feedSlotOf('シード3', { participantNo: 3, seed: 3 }),
        feedSlotOf('1回戦第3試合の勝者'),
      ]),
    );

    await expect
      .element(card().getByText('予定', { exact: true }))
      .toBeVisible();
    await expect.element(sideOf(0)).toHaveTextContent('シード3');
    await expect.element(sideOf(1)).toHaveTextContent('vs1回戦第3試合の勝者');
    expect(page.getByText('Upvote数').elements()).toHaveLength(0);
    expect(page.getByText('シード3').elements()).toHaveLength(1);
  });

  test('予定を作る前の1回戦の非シードの枠は抽選番号だけを示す', async () => {
    await renderCard(
      bracketNodeOf(1, null, [
        playedSlotOf(4, { product: null, upvoteCount: null }),
        playedSlotOf(5, { product: null, upvoteCount: null }),
      ]),
      '1回戦',
    );

    await expect.element(sideOf(0)).toHaveTextContent('抽選番号4');
    await expect.element(sideOf(1)).toHaveTextContent('vs抽選番号5');
  });

  test('表示できないプロダクトは「非公開のプロダクト」と示し、名称もリンクも出さない', async () => {
    await renderCard(
      bracketNodeOf(1, bracketMatchOf(1, { phase: 'LIVE' }), [
        playedSlotOf(1, { seed: 1, upvoteCount: 4 }),
        playedSlotOf(8, { product: null, upvoteCount: 2 }),
      ]),
    );

    await expect
      .element(sideOf(1))
      .toHaveTextContent('vs非公開のプロダクトUpvote数2');
    expect(page.getByText('Bracket Product 8').elements()).toHaveLength(0);
    expect(page.getByRole('link').elements()).toHaveLength(1);
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test.each<readonly [string, BracketViewNode]>([
    [
      '確定',
      bracketNodeOf(
        1,
        bracketMatchOf(1, { phase: 'FINISHED', decision: 'VOTES' }),
        [
          playedSlotOf(1, { seed: 1, upvoteCount: 3, result: 'WON' }),
          playedSlotOf(8, { product: null, upvoteCount: 2, result: 'LOST' }),
        ],
      ),
    ],
    [
      'マッチ中',
      bracketNodeOf(1, bracketMatchOf(1, { phase: 'LIVE' }), [
        playedSlotOf(1),
        playedSlotOf(2, { product: bracketProductOf(2, { listed: false }) }),
      ]),
    ],
    [
      '予定の前',
      bracketNodeOf(1, null, [feedSlotOf('シード1'), EMPTY_BRACKET_SLOT]),
    ],
  ])('%sのマッチのアクセシビリティの検査の違反が0件', async (_, node) => {
    applyColorScheme(scheme);
    await renderCard(node);

    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
