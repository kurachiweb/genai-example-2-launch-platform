import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { hasHorizontalScroll } from '../../../lib/test/overflow.ts';
import {
  bracketMatchOf,
  bracketNodeOf,
  bracketProductOf,
  bracketRoundOf,
  playedSlotOf,
} from '../bracket/bracket-fixtures.ts';
import type { BracketViewRound } from '../bracket/bracket-view-props.ts';
import { renderInMatchFrame } from '../match/match-testing.tsx';
import {
  AWARDED_WEEK_BRACKET,
  WEEK_BRACKET_LABEL,
  weekBracketOf,
} from './week-bracket-fixtures.ts';
import type { WeekBracketView } from './week-bracket-model.ts';
import { WeekBracketPage } from './week-bracket-page.tsx';

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const COLUMNS_WIDTH = 768;

const TABS_WIDTH = 767;

const VIEWPORT_HEIGHT = 900;

const ROUND_NAMES = ['1回戦', '準決勝', '決勝'];

const renderPage = async (
  bracket: WeekBracketView,
  {
    autoRefresh = true,
    onAutoRefreshChange = vi.fn(),
  }: {
    readonly autoRefresh?: boolean;
    readonly onAutoRefreshChange?: (checked: boolean) => void;
  } = {},
) => {
  await renderInMatchFrame(
    <WeekBracketPage
      bracket={bracket}
      autoRefresh={autoRefresh}
      onAutoRefreshChange={onAutoRefreshChange}
    />,
    { host: 'none' },
  );
};

const pageTitle = () => page.getByRole('heading', { level: 1 });
const scrollRegion = () =>
  page.getByRole('region', { name: 'ブラケット(横にスクロールできます)' });
const tabList = () => page.getByRole('tablist', { name: 'ラウンド' });
const tab = (name: string) => page.getByRole('tab', { name, exact: true });
const autoRefreshSwitch = () => page.getByRole('switch', { name: '自動更新' });
const awardHeading = () =>
  page.getByRole('heading', { level: 2, name: 'Product of the Week' });

const roundHeadingsIn = (
  container: ReturnType<typeof page.getByRole>,
): (string | null)[] =>
  container
    .getByRole('heading', { level: 2 })
    .elements()
    .map((heading) => heading.textContent);

// 1回戦から決勝までの5ラウンド(参加32)。各ラウンドに1試合だけ置き、列の数で幅を超えさせる
const FIVE_ROUNDS: readonly BracketViewRound[] = [
  '1回戦',
  '2回戦',
  '準々決勝',
  '準決勝',
  '決勝',
].map((name, index) =>
  bracketRoundOf(index + 1, name, `2026-11-1${String(index)}`, [
    bracketNodeOf(1, bracketMatchOf(index + 1, { round: index + 1 }), [
      playedSlotOf(1),
      playedSlotOf(2),
    ]),
  ]),
);

beforeEach(async () => {
  await page.viewport(COLUMNS_WIDTH, VIEWPORT_HEIGHT);
});

afterEach(() => {
  applyColorScheme('light');
});

describe('WeekBracketPage の見出し', () => {
  test('h1にトーナメントの名前と週の表記を置き、参加数とシード数を添える', async () => {
    await renderPage(weekBracketOf({ participantCount: 13, seedCount: 3 }));

    await expect
      .element(pageTitle())
      .toHaveTextContent(
        `Product of the Weekトーナメント ${WEEK_BRACKET_LABEL}`,
      );
    await expect.element(page.getByText('参加13・シード3')).toBeVisible();
  });
});

describe('WeekBracketPage の自動更新の切り替え', () => {
  test('開催中は、ページの上部に「自動更新」の切り替えを受け取った状態で描き、操作を呼び出し元へ伝える', async () => {
    const onAutoRefreshChange = vi.fn();
    await renderPage(weekBracketOf(), { onAutoRefreshChange });

    await expect.element(autoRefreshSwitch()).toBeChecked();
    await expect
      .element(autoRefreshSwitch())
      .toHaveAccessibleDescription(
        'オンの間は30秒ごとにUpvote数を取り直し、残り時間と演出を動かします。',
      );

    await userEvent.click(autoRefreshSwitch());

    expect(onAutoRefreshChange).toHaveBeenCalledWith(false);
  });

  test('オフの状態を受け取ると、切り替えをオフで描く', async () => {
    await renderPage(weekBracketOf(), { autoRefresh: false });

    await expect.element(autoRefreshSwitch()).not.toBeChecked();
  });

  test('終了した週は、取り直さないため切り替えを描かない', async () => {
    await renderPage(AWARDED_WEEK_BRACKET);

    await expect.element(awardHeading()).toBeVisible();
    await expect.element(autoRefreshSwitch()).not.toBeInTheDocument();
  });
});

describe('WeekBracketPage の画面幅による切り替え', () => {
  test('768px以上は、ラウンドを横スクロールの領域の中の列に1回戦から順に並べ、タブを出さない', async () => {
    await renderPage(weekBracketOf());

    await expect.element(scrollRegion()).toBeVisible();
    expect(roundHeadingsIn(scrollRegion())).toStrictEqual([
      '1回戦(11月10日)',
      '準決勝(11月11日)',
      '決勝(11月12日)',
    ]);
    await expect.element(tabList()).not.toBeInTheDocument();
    const columns = scrollRegion()
      .getByRole('heading', { level: 2 })
      .elements()
      .map((heading) => heading.getBoundingClientRect());
    expect(new Set(columns.map(({ top }) => top)).size).toBe(1);
    const lefts = columns.map(({ left }) => left);
    expect(lefts).toStrictEqual([...lefts].sort((a, b) => a - b));
    expect(new Set(lefts).size).toBe(columns.length);
  });

  test('767px以下は、ラウンドをタブで切り替えて1列で示し、既定で進行中のラウンドを選ぶ', async () => {
    await page.viewport(TABS_WIDTH, VIEWPORT_HEIGHT);
    await renderPage(weekBracketOf());

    await expect.element(tabList()).toBeVisible();
    await expect.element(scrollRegion()).not.toBeInTheDocument();
    expect(
      page
        .getByRole('tab')
        .elements()
        .map((element) => element.textContent),
    ).toStrictEqual(ROUND_NAMES);
    await expect
      .element(tab('準決勝'))
      .toHaveAttribute('aria-selected', 'true');

    await userEvent.click(tab('決勝'));

    await expect
      .element(page.getByRole('tabpanel').getByRole('heading', { level: 2 }))
      .toHaveTextContent('決勝(11月12日)');
  });

  test('画面幅を跨ぐと、列とタブを切り替える', async () => {
    await renderPage(weekBracketOf());
    await expect.element(scrollRegion()).toBeVisible();

    await page.viewport(TABS_WIDTH, VIEWPORT_HEIGHT);

    await expect.element(tabList()).toBeVisible();
    await expect.element(scrollRegion()).not.toBeInTheDocument();

    await page.viewport(COLUMNS_WIDTH, VIEWPORT_HEIGHT);

    await expect.element(scrollRegion()).toBeVisible();
    await expect.element(tabList()).not.toBeInTheDocument();
  });

  test('列が画面に収まらないときは、領域の中だけを横スクロールにしてページを横にスクロールさせない', async () => {
    await renderPage(weekBracketOf({ rounds: [...FIVE_ROUNDS] }));
    await expect.element(scrollRegion()).toBeVisible();

    const region = scrollRegion().element();
    expect(region.scrollWidth).toBeGreaterThan(region.clientWidth);
    expect(hasHorizontalScroll()).toBe(false);
  });

  test('横スクロールの領域はキーボードでフォーカスでき、Tabで列の中のマッチへ進める', async () => {
    await renderPage(AWARDED_WEEK_BRACKET);
    await expect.element(scrollRegion()).toBeVisible();

    await userEvent.tab();
    await expect
      .element(page.getByRole('link', { name: 'Bracket Product 1' }).first())
      .toHaveFocus();
    await userEvent.tab();
    await expect.element(scrollRegion()).toHaveFocus();
    await userEvent.tab();
    await expect
      .element(
        scrollRegion().getByRole('link', { name: 'Bracket Product 3' }).first(),
      )
      .toHaveFocus();
  });
});

describe('WeekBracketPage の照会の結果からの受け渡し', () => {
  test('終了の前は、優勝の欄を出さない', async () => {
    await renderPage(weekBracketOf());

    await expect.element(scrollRegion()).toBeVisible();
    await expect.element(awardHeading()).not.toBeInTheDocument();
  });

  test('受賞で終えた週は、受賞したプロダクトを「Product of the Week」の印とともに示す', async () => {
    await renderPage(AWARDED_WEEK_BRACKET);

    await expect.element(awardHeading()).toBeVisible();
    const champion = page.getByRole('region', { name: 'Product of the Week' });
    await expect
      .element(champion.getByRole('link', { name: 'Bracket Product 1' }))
      .toHaveAttribute('href', '/p/bracket-product-1');
  });

  test('表示できないプロダクトが受賞した週(championがnull)は、「非公開のプロダクト」の受賞として示す', async () => {
    await renderPage(
      weekBracketOf({
        tournament: { status: 'FINISHED', awarded: true },
        champion: null,
      }),
    );

    const champion = page.getByRole('region', { name: 'Product of the Week' });
    await expect
      .element(champion.getByText('非公開のプロダクト'))
      .toBeVisible();
    expect(champion.getByRole('link').elements()).toHaveLength(0);
  });

  test('受賞なしで終えた週(awardedが偽)は、「受賞プロダクトはありません」を示す', async () => {
    await renderPage(
      weekBracketOf({ tournament: { status: 'FINISHED', awarded: false } }),
    );

    const champion = page.getByRole('region', { name: 'Product of the Week' });
    await expect
      .element(champion.getByText('受賞プロダクトはありません'))
      .toBeVisible();
  });

  test('参加1で終えた週は、ラウンドを並べず受賞だけを示す', async () => {
    await renderPage(
      weekBracketOf({
        tournament: { status: 'FINISHED', awarded: true },
        participantCount: 1,
        seedCount: 0,
        rounds: [],
        champion: bracketProductOf(7),
      }),
    );

    await expect.element(page.getByText('参加1・シード0')).toBeVisible();
    await expect
      .element(page.getByRole('link', { name: 'Bracket Product 7' }))
      .toBeVisible();
    await expect.element(scrollRegion()).not.toBeInTheDocument();
    await expect.element(tabList()).not.toBeInTheDocument();
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test.each([COLUMNS_WIDTH, TABS_WIDTH])(
    '開催中の週は、画面幅%ipxで自動更新の切り替えを含めてアクセシビリティの検査の違反が0件',
    async (width) => {
      applyColorScheme(scheme);
      await page.viewport(width, VIEWPORT_HEIGHT);
      await renderPage(weekBracketOf());
      await expect.element(autoRefreshSwitch()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test.each([COLUMNS_WIDTH, TABS_WIDTH])(
    '終了した週は、画面幅%ipxでアクセシビリティの検査の違反が0件',
    async (width) => {
      applyColorScheme(scheme);
      await page.viewport(width, VIEWPORT_HEIGHT);
      await renderPage(AWARDED_WEEK_BRACKET);
      await expect.element(awardHeading()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
