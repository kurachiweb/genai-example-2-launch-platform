import { afterEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { renderInMatchFrame } from '../match/match-testing.tsx';
import { BracketChampion } from './bracket-champion.tsx';
import { bracketProductOf } from './bracket-fixtures.ts';
import { BracketRoundTabs } from './bracket-round-tabs.tsx';
import type { BracketViewProps } from './bracket-view-props.ts';

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const AWARD_NAME = 'Product of the Week';

const renderChampion = async (
  props: Pick<BracketViewProps, 'champion' | 'awarded' | 'finished'>,
) => {
  await renderInMatchFrame(
    <BracketChampion awardName={AWARD_NAME} {...props} />,
    {
      width: 360,
    },
  );
};

const championRegion = () => page.getByRole('region', { name: AWARD_NAME });

afterEach(() => {
  applyColorScheme('light');
});

describe('BracketChampion', () => {
  test('受賞したプロダクトを賞の名前の見出しの区画に示し、掲載されていれば詳細へのリンクにする', async () => {
    await renderChampion({
      champion: bracketProductOf(1),
      awarded: true,
      finished: true,
    });

    await expect
      .element(page.getByRole('heading', { level: 2, name: AWARD_NAME }))
      .toBeVisible();
    await expect
      .element(
        championRegion().getByRole('link', { name: 'Bracket Product 1' }),
      )
      .toHaveAttribute('href', '/p/bracket-product-1');
  });

  test('掲載されていないプロダクトの受賞は名称だけを示す', async () => {
    await renderChampion({
      champion: bracketProductOf(1, { listed: false }),
      awarded: true,
      finished: true,
    });

    await expect
      .element(championRegion().getByText('Bracket Product 1'))
      .toBeVisible();
    expect(page.getByRole('link').elements()).toHaveLength(0);
  });

  test('受賞したプロダクトを表示できなければ「非公開のプロダクト」の受賞と示す', async () => {
    await renderChampion({ champion: null, awarded: true, finished: true });

    await expect
      .element(championRegion().getByText('非公開のプロダクト'))
      .toBeVisible();
    expect(page.getByRole('link').elements()).toHaveLength(0);
  });

  test('受賞せずに終えたら「受賞プロダクトはありません」と示す', async () => {
    await renderChampion({ champion: null, awarded: false, finished: true });

    await expect
      .element(championRegion().getByText('受賞プロダクトはありません'))
      .toBeVisible();
  });

  test('終了の前は何も描かない', async () => {
    await renderChampion({ champion: null, awarded: false, finished: false });

    expect(page.getByRole('region').elements()).toHaveLength(0);
    expect(page.getByRole('heading').elements()).toHaveLength(0);
  });

  test('参加1でラウンドが空のトーナメントは、ラウンドを並べず優勝だけを示す', async () => {
    const view: BracketViewProps = {
      rounds: [],
      champion: bracketProductOf(1),
      awarded: true,
      finished: true,
    };
    await renderInMatchFrame(
      <>
        <BracketChampion awardName={AWARD_NAME} {...view} />
        <BracketRoundTabs rounds={view.rounds} />
      </>,
      { width: 360 },
    );

    await expect
      .element(championRegion().getByText('Bracket Product 1'))
      .toBeVisible();
    expect(page.getByRole('tablist').elements()).toHaveLength(0);
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test.each<
    readonly [
      string,
      Pick<BracketViewProps, 'champion' | 'awarded' | 'finished'>,
    ]
  >([
    ['受賞', { champion: bracketProductOf(1), awarded: true, finished: true }],
    [
      '表示できないプロダクトの受賞',
      { champion: null, awarded: true, finished: true },
    ],
    ['受賞なし', { champion: null, awarded: false, finished: true }],
  ])('%sのアクセシビリティの検査の違反が0件', async (_, props) => {
    applyColorScheme(scheme);
    await renderChampion(props);

    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
