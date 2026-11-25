import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { pressKeyUntilFocusMoves } from '../../../lib/test/keyboard.ts';
import { hasHorizontalScroll } from '../../../lib/test/overflow.ts';
import { bracketRoundOf } from '../bracket/bracket-fixtures.ts';
import { renderInMatchFrame } from '../match/match-testing.tsx';
import type { YearBracketView } from './year-bracket-model.ts';
import { YearBracketPage } from './year-bracket-page.tsx';
import {
  AWARDED_YEAR_BRACKET,
  HIDDEN_CHAMPION_YEAR_BRACKET,
  NO_AWARD_YEAR_BRACKET,
  YEAR_FINAL_DATE,
  YEAR_IN_PROGRESS_ROUNDS,
  YEAR_TOURNAMENT_LABEL,
  yearBracketOf,
} from './year-tournament-fixtures.ts';

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const COLUMNS_WIDTH = 768;

const TABS_WIDTH = 767;

const VIEWPORT_HEIGHT = 900;

const ROUND_NAMES = ['1回戦', '準決勝', '決勝'];

const AWARD_NAME = 'Product of the Year';

// 1回戦2試合・準決勝2試合・決勝1試合
const MATCH_HEADINGS = [
  '1回戦第1試合',
  '1回戦第2試合',
  '準決勝第1試合',
  '準決勝第2試合',
  '決勝第1試合',
];

const renderPage = async (
  bracket: YearBracketView,
  {
    autoRefresh = true,
    onAutoRefreshChange = vi.fn(),
  }: {
    readonly autoRefresh?: boolean;
    readonly onAutoRefreshChange?: (checked: boolean) => void;
  } = {},
) => {
  await renderInMatchFrame(
    <YearBracketPage
      bracket={bracket}
      autoRefresh={autoRefresh}
      onAutoRefreshChange={onAutoRefreshChange}
    />,
    { host: 'none' },
  );
};

const pageTitle = () => page.getByRole('heading', { level: 1 });
const pageHeader = (): HTMLElement => {
  const header = pageTitle().element().closest('header');
  if (!(header instanceof HTMLElement)) {
    throw new Error('ページの見出しの領域が無い');
  }
  return header;
};
const scrollRegion = () =>
  page.getByRole('region', { name: 'ブラケット(横にスクロールできます)' });
const tabList = () => page.getByRole('tablist', { name: 'ラウンド' });
const tab = (name: string) => page.getByRole('tab', { name, exact: true });
const autoRefreshSwitch = () => page.getByRole('switch', { name: '自動更新' });
const awardHeading = () =>
  page.getByRole('heading', { level: 2, name: AWARD_NAME });
const championRegion = () => page.getByRole('region', { name: AWARD_NAME });

const matchHeadingsIn = (
  container: ReturnType<typeof page.getByRole>,
): (string | null)[] =>
  container
    .getByRole('article')
    .elements()
    .map((article) => article.querySelector('h3')?.textContent ?? null);

const finalDateTimesInHeader = (): (string | null)[] =>
  [...pageHeader().querySelectorAll('time')].map((time) =>
    time.getAttribute('datetime'),
  );

beforeEach(async () => {
  await page.viewport(COLUMNS_WIDTH, VIEWPORT_HEIGHT);
});

afterEach(() => {
  applyColorScheme('light');
});

describe('YearBracketPage の見出し', () => {
  test('h1に「Product of the Yearトーナメント」と対象年を置き、決勝日を業務日付の<time>で、参加数とシード数を「参加13・シード3」で添える', async () => {
    await renderPage(yearBracketOf({ participantCount: 13, seedCount: 3 }));

    await expect
      .element(pageTitle())
      .toHaveTextContent(
        `Product of the Yearトーナメント ${YEAR_TOURNAMENT_LABEL}`,
      );
    await expect.element(page.getByText('参加13・シード3')).toBeVisible();
    expect(finalDateTimesInHeader()).toStrictEqual([YEAR_FINAL_DATE]);
    expect(pageHeader().textContent).toMatch(/決勝日(2027年)?5月30日/u);
  });

  test('ラウンドの遅れで決勝の実施日が設定した決勝日より後になった年は、遅らせた後の日を決勝日に示す', async () => {
    const final = YEAR_IN_PROGRESS_ROUNDS.at(-1);
    if (final === undefined) {
      throw new Error('決勝のラウンドが無い');
    }
    await renderPage(
      yearBracketOf({
        rounds: [
          ...YEAR_IN_PROGRESS_ROUNDS.slice(0, -1),
          bracketRoundOf(final.round, final.name, '2027-05-31', final.nodes),
        ],
      }),
    );

    await expect.element(pageTitle()).toBeVisible();
    expect(finalDateTimesInHeader()).toStrictEqual(['2027-05-31']);
  });
});

describe('YearBracketPage の自動更新の切り替え', () => {
  test('開催中は、「自動更新」の切り替えをブラケットの取り直しの説明とともに受け取った状態で描き、操作を呼び出し元へ伝える', async () => {
    const onAutoRefreshChange = vi.fn();
    await renderPage(yearBracketOf(), { onAutoRefreshChange });

    await expect.element(autoRefreshSwitch()).toBeChecked();
    await expect
      .element(autoRefreshSwitch())
      .toHaveAccessibleDescription(
        'オンの間は30秒ごとにブラケットを取り直します。',
      );

    await userEvent.click(autoRefreshSwitch());

    expect(onAutoRefreshChange).toHaveBeenCalledWith(false);
  });

  test('オフの状態を受け取ると、切り替えをオフで描く', async () => {
    await renderPage(yearBracketOf(), { autoRefresh: false });

    await expect.element(autoRefreshSwitch()).not.toBeChecked();
  });

  test('終了した年は、取り直さないため切り替えを描かない', async () => {
    await renderPage(AWARDED_YEAR_BRACKET);

    await expect.element(awardHeading()).toBeVisible();
    await expect.element(autoRefreshSwitch()).not.toBeInTheDocument();
  });
});

describe('YearBracketPage の照会の結果からの受け渡し', () => {
  test('開催中の年(受賞の有無がnull)は、受賞でないものとして渡し、優勝の欄を出さずにラウンドを並べる', async () => {
    const bracket = yearBracketOf();
    expect(bracket.tournament.awarded).toBeNull();

    await renderPage(bracket);

    await expect.element(scrollRegion()).toBeVisible();
    await expect.element(awardHeading()).not.toBeInTheDocument();
    expect(
      page.getByText('非公開のプロダクト', { exact: true }).elements(),
    ).toHaveLength(0);
    expect(
      page.getByText('受賞プロダクトはありません').elements(),
    ).toHaveLength(0);
    expect(matchHeadingsIn(scrollRegion())).toStrictEqual(MATCH_HEADINGS);
  });

  test('受賞で終えた年は、受賞したプロダクトを「Product of the Year」の印とともに示す', async () => {
    await renderPage(AWARDED_YEAR_BRACKET);

    await expect.element(awardHeading()).toBeVisible();
    await expect
      .element(
        championRegion().getByRole('link', { name: 'Bracket Product 1' }),
      )
      .toHaveAttribute('href', '/p/bracket-product-1');
  });

  test('受賞したプロダクトが表示できない年(championがnullで受賞が真)は、「非公開のプロダクト」の受賞としてリンクを出さずに示す', async () => {
    expect(HIDDEN_CHAMPION_YEAR_BRACKET.champion).toBeNull();
    expect(HIDDEN_CHAMPION_YEAR_BRACKET.tournament.awarded).toBe(true);

    await renderPage(HIDDEN_CHAMPION_YEAR_BRACKET);

    await expect
      .element(championRegion().getByText('非公開のプロダクト'))
      .toBeVisible();
    expect(championRegion().getByRole('link').elements()).toHaveLength(0);
    expect(
      championRegion().getByText('受賞プロダクトはありません').elements(),
    ).toHaveLength(0);
  });

  test('受賞なしで終えた年(受賞が偽)は、「受賞プロダクトはありません」を示す', async () => {
    await renderPage(NO_AWARD_YEAR_BRACKET);

    await expect
      .element(championRegion().getByText('受賞プロダクトはありません'))
      .toBeVisible();
    expect(championRegion().getByRole('link').elements()).toHaveLength(0);
  });

  test('参加1で終えた年は、ラウンドを並べず受賞だけを示す', async () => {
    await renderPage(
      yearBracketOf({
        tournament: { status: 'FINISHED', awarded: true },
        participantCount: 1,
        seedCount: 0,
        rounds: [],
        champion: AWARDED_YEAR_BRACKET.champion,
      }),
    );

    await expect.element(page.getByText('参加1・シード0')).toBeVisible();
    await expect
      .element(
        championRegion().getByRole('link', { name: 'Bracket Product 1' }),
      )
      .toBeVisible();
    await expect.element(scrollRegion()).not.toBeInTheDocument();
    await expect.element(tabList()).not.toBeInTheDocument();
  });
});

describe('YearBracketPage の画面幅による切り替え', () => {
  test('768px以上は、ラウンドを横スクロールの領域の中の列に1回戦から順に並べ、タブを出さない', async () => {
    await renderPage(yearBracketOf());

    await expect.element(scrollRegion()).toBeVisible();
    await expect.element(tabList()).not.toBeInTheDocument();
    expect(
      scrollRegion()
        .getByRole('heading', { level: 2 })
        .elements()
        .map((heading) => heading.textContent),
    ).toStrictEqual([
      expect.stringMatching(/^1回戦\((2027年)?5月28日\)$/u),
      expect.stringMatching(/^準決勝\((2027年)?5月29日\)$/u),
      expect.stringMatching(/^決勝\((2027年)?5月30日\)$/u),
    ]);
    expect(hasHorizontalScroll()).toBe(false);
  });

  test('767px以下は、ラウンドをタブで切り替えて1列で示し、既定で進行中のラウンドを選ぶ', async () => {
    await page.viewport(TABS_WIDTH, VIEWPORT_HEIGHT);
    await renderPage(yearBracketOf());

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
    expect(hasHorizontalScroll()).toBe(false);
  });

  test('画面幅を767pxと768pxで跨ぐと、列とタブを切り替える', async () => {
    await renderPage(yearBracketOf());
    await expect.element(scrollRegion()).toBeVisible();

    await page.viewport(TABS_WIDTH, VIEWPORT_HEIGHT);

    await expect.element(tabList()).toBeVisible();
    await expect.element(scrollRegion()).not.toBeInTheDocument();

    await page.viewport(COLUMNS_WIDTH, VIEWPORT_HEIGHT);

    await expect.element(scrollRegion()).toBeVisible();
    await expect.element(tabList()).not.toBeInTheDocument();
  });
});

describe('YearBracketPage のキーボードでのたどり方', () => {
  test('768px以上は、フォーカスできる横スクロールの領域に全マッチが見出しを持つ記事として並び、Tabで領域の中のマッチへ進める', async () => {
    await renderPage(AWARDED_YEAR_BRACKET);
    await expect.element(scrollRegion()).toBeVisible();
    expect(matchHeadingsIn(scrollRegion())).toStrictEqual(MATCH_HEADINGS);

    await userEvent.tab();
    await expect
      .element(
        championRegion().getByRole('link', { name: 'Bracket Product 1' }),
      )
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

  test('767px以下は、矢印のキーでタブを切り替えて全ラウンドのマッチを順にたどれる', async () => {
    await page.viewport(TABS_WIDTH, VIEWPORT_HEIGHT);
    await renderPage(yearBracketOf());
    const panelMatches = () => matchHeadingsIn(page.getByRole('tabpanel'));

    await userEvent.tab();
    await expect.element(autoRefreshSwitch()).toHaveFocus();
    await userEvent.tab();
    await expect.element(tab('準決勝')).toHaveFocus();

    await pressKeyUntilFocusMoves('Home');
    await expect.element(tab('1回戦')).toHaveAttribute('aria-selected', 'true');
    expect(panelMatches()).toStrictEqual(MATCH_HEADINGS.slice(0, 2));

    await pressKeyUntilFocusMoves('ArrowRight');
    await expect
      .element(tab('準決勝'))
      .toHaveAttribute('aria-selected', 'true');
    expect(panelMatches()).toStrictEqual(MATCH_HEADINGS.slice(2, 4));

    await pressKeyUntilFocusMoves('ArrowRight');
    await expect.element(tab('決勝')).toHaveAttribute('aria-selected', 'true');
    expect(panelMatches()).toStrictEqual(MATCH_HEADINGS.slice(4));

    await userEvent.tab();
    await expect.element(page.getByRole('tabpanel')).toHaveFocus();
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test.each([COLUMNS_WIDTH, TABS_WIDTH])(
    '開催中の年は、画面幅%ipxで自動更新の切り替えを含めてアクセシビリティの検査の違反が0件',
    async (width) => {
      applyColorScheme(scheme);
      await page.viewport(width, VIEWPORT_HEIGHT);
      await renderPage(yearBracketOf());
      await expect.element(autoRefreshSwitch()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test.each([COLUMNS_WIDTH, TABS_WIDTH])(
    '受賞したプロダクトが表示できない年は、画面幅%ipxでアクセシビリティの検査の違反が0件',
    async (width) => {
      applyColorScheme(scheme);
      await page.viewport(width, VIEWPORT_HEIGHT);
      await renderPage(HIDDEN_CHAMPION_YEAR_BRACKET);
      await expect.element(awardHeading()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
