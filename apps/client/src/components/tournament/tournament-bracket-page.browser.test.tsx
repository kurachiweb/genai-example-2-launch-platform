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
  YEAR_FINAL_DATE,
  YEAR_TOURNAMENT_LABEL,
} from '../year-tournament/year-tournament-fixtures.ts';
import { YEAR_BRACKET_COPY } from '../year-tournament/year-tournament-messages.ts';
import {
  AWARDED_TOURNAMENT_BRACKET,
  BRACKET_AWARD_NAME,
  BRACKET_COPY,
  BRACKET_PERIOD_LABEL,
  BRACKET_TITLE,
  tournamentBracketOf,
} from './tournament-bracket-fixtures.ts';
import type { TournamentBracketPageView } from './tournament-bracket-model.ts';
import { TournamentBracketPage } from './tournament-bracket-page.tsx';

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const COLUMNS_WIDTH = 768;

const TABS_WIDTH = 767;

const VIEWPORT_HEIGHT = 900;

const ROUND_NAMES = ['1回戦', '準決勝', '決勝'];

const renderPage = async (
  bracket: TournamentBracketPageView,
  {
    autoRefresh = true,
    onAutoRefreshChange = vi.fn(),
  }: {
    readonly autoRefresh?: boolean;
    readonly onAutoRefreshChange?: (checked: boolean) => void;
  } = {},
) => {
  await renderInMatchFrame(
    <TournamentBracketPage
      copy={BRACKET_COPY}
      periodLabel={BRACKET_PERIOD_LABEL}
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
  page.getByRole('heading', { level: 2, name: BRACKET_AWARD_NAME });
const championRegion = () =>
  page.getByRole('region', { name: BRACKET_AWARD_NAME });

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

describe('TournamentBracketPage の見出し', () => {
  test('h1に文言の題名と期間の表記を置き、文言の表記で参加数とシード数を添える', async () => {
    await renderPage(
      tournamentBracketOf({ participantCount: 13, seedCount: 3 }),
    );

    await expect
      .element(pageTitle())
      .toHaveTextContent(`${BRACKET_TITLE} ${BRACKET_PERIOD_LABEL}`);
    await expect
      .element(page.getByText('テストの参加13・シード3'))
      .toBeVisible();
  });
});

describe('TournamentBracketPage の自動更新の切り替え', () => {
  test('開催中は、ページの上部に「自動更新」の切り替えをブラケットの取り直しの説明とともに受け取った状態で描き、操作を呼び出し元へ伝える', async () => {
    const onAutoRefreshChange = vi.fn();
    await renderPage(tournamentBracketOf(), { onAutoRefreshChange });

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
    await renderPage(tournamentBracketOf(), { autoRefresh: false });

    await expect.element(autoRefreshSwitch()).not.toBeChecked();
  });

  test('終了したトーナメントは、取り直さないため切り替えを描かない', async () => {
    await renderPage(AWARDED_TOURNAMENT_BRACKET);

    await expect.element(awardHeading()).toBeVisible();
    await expect.element(autoRefreshSwitch()).not.toBeInTheDocument();
  });
});

describe('TournamentBracketPage の画面幅による切り替え', () => {
  test('768px以上は、ラウンドを横スクロールの領域の中の列に1回戦から順に並べ、タブを出さない', async () => {
    await renderPage(tournamentBracketOf());

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
    await renderPage(tournamentBracketOf());

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
    await renderPage(tournamentBracketOf());
    await expect.element(scrollRegion()).toBeVisible();

    await page.viewport(TABS_WIDTH, VIEWPORT_HEIGHT);

    await expect.element(tabList()).toBeVisible();
    await expect.element(scrollRegion()).not.toBeInTheDocument();

    await page.viewport(COLUMNS_WIDTH, VIEWPORT_HEIGHT);

    await expect.element(scrollRegion()).toBeVisible();
    await expect.element(tabList()).not.toBeInTheDocument();
  });

  test('列が画面に収まらないときは、領域の中だけを横スクロールにしてページを横にスクロールさせない', async () => {
    await renderPage(tournamentBracketOf({ rounds: [...FIVE_ROUNDS] }));
    await expect.element(scrollRegion()).toBeVisible();

    const region = scrollRegion().element();
    expect(region.scrollWidth).toBeGreaterThan(region.clientWidth);
    expect(hasHorizontalScroll()).toBe(false);
  });

  test('横スクロールの領域はキーボードでフォーカスでき、Tabで列の中のマッチへ進める', async () => {
    await renderPage(AWARDED_TOURNAMENT_BRACKET);
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

describe('TournamentBracketPage の照会の結果からの受け渡し', () => {
  test('終了の前は、優勝の欄を出さない', async () => {
    await renderPage(tournamentBracketOf());

    await expect.element(scrollRegion()).toBeVisible();
    await expect.element(awardHeading()).not.toBeInTheDocument();
  });

  test('受賞で終えたトーナメントは、受賞したプロダクトを文言の賞の名前の印とともに示す', async () => {
    await renderPage(AWARDED_TOURNAMENT_BRACKET);

    await expect.element(awardHeading()).toBeVisible();
    await expect
      .element(
        championRegion().getByRole('link', { name: 'Bracket Product 1' }),
      )
      .toHaveAttribute('href', '/p/bracket-product-1');
  });

  test('表示できないプロダクトが受賞したトーナメント(championがnull)は、「非公開のプロダクト」の受賞として示す', async () => {
    await renderPage(
      tournamentBracketOf({
        tournament: { status: 'FINISHED', awarded: true },
        champion: null,
      }),
    );

    await expect
      .element(championRegion().getByText('非公開のプロダクト'))
      .toBeVisible();
    expect(championRegion().getByRole('link').elements()).toHaveLength(0);
  });

  test('受賞なしで終えたトーナメント(awardedが偽)は、「受賞プロダクトはありません」を示す', async () => {
    await renderPage(
      tournamentBracketOf({
        tournament: { status: 'FINISHED', awarded: false },
      }),
    );

    await expect
      .element(championRegion().getByText('受賞プロダクトはありません'))
      .toBeVisible();
  });

  test('参加1で終えたトーナメントは、ラウンドを並べず受賞だけを示す', async () => {
    await renderPage(
      tournamentBracketOf({
        tournament: { status: 'FINISHED', awarded: true },
        participantCount: 1,
        seedCount: 0,
        rounds: [],
        champion: bracketProductOf(7),
      }),
    );

    await expect
      .element(page.getByText('テストの参加1・シード0'))
      .toBeVisible();
    await expect
      .element(page.getByRole('link', { name: 'Bracket Product 7' }))
      .toBeVisible();
    await expect.element(scrollRegion()).not.toBeInTheDocument();
    await expect.element(tabList()).not.toBeInTheDocument();
  });
});

describe('TournamentBracketPageのYearの文言の例', () => {
  const renderYearPage = async (
    bracket: TournamentBracketPageView,
    finalDate?: string,
  ) => {
    await renderInMatchFrame(
      <TournamentBracketPage
        copy={YEAR_BRACKET_COPY}
        periodLabel={YEAR_TOURNAMENT_LABEL}
        {...(finalDate === undefined ? {} : { finalDate })}
        bracket={bracket}
        autoRefresh
        onAutoRefreshChange={vi.fn()}
      />,
      { host: 'none' },
    );
  };

  const header = (): HTMLElement => {
    const element = pageTitle().element().closest('header');
    if (!(element instanceof HTMLElement)) {
      throw new Error('ページの見出しの領域が無い');
    }
    return element;
  };

  test('Yearの文言と決勝日を渡すと、h1に「Product of the Yearトーナメント」と対象年を置き、決勝日を業務日付の<time>で、参加数とシード数を「参加13・シード3」で添える', async () => {
    await renderYearPage(
      tournamentBracketOf({ participantCount: 13, seedCount: 3 }),
      YEAR_FINAL_DATE,
    );

    await expect
      .element(pageTitle())
      .toHaveTextContent(
        `Product of the Yearトーナメント ${YEAR_TOURNAMENT_LABEL}`,
      );
    await expect.element(page.getByText('参加13・シード3')).toBeVisible();
    expect(
      [...header().querySelectorAll('time')].map((time) =>
        time.getAttribute('datetime'),
      ),
    ).toStrictEqual([YEAR_FINAL_DATE]);
    expect(header().textContent).toMatch(/決勝日(2027年)?5月30日/u);
    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test('Yearの文言で受賞して終えたトーナメントは、「Product of the Year」の印で受賞したプロダクトを示す', async () => {
    await renderYearPage(AWARDED_TOURNAMENT_BRACKET, YEAR_FINAL_DATE);

    await expect
      .element(
        page.getByRole('heading', { level: 2, name: 'Product of the Year' }),
      )
      .toBeVisible();
    await expect
      .element(
        page
          .getByRole('region', { name: 'Product of the Year' })
          .getByRole('link', { name: 'Bracket Product 1' }),
      )
      .toHaveAttribute('href', '/p/bracket-product-1');
  });

  test('決勝日を渡さなければ、見出しに決勝日の項目を置かない', async () => {
    await renderYearPage(tournamentBracketOf());

    await expect.element(pageTitle()).toBeVisible();
    expect(header().querySelectorAll('time')).toHaveLength(0);
    expect(header().textContent).not.toContain('決勝日');
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test.each([COLUMNS_WIDTH, TABS_WIDTH])(
    '開催中のトーナメントは、画面幅%ipxで自動更新の切り替えを含めてアクセシビリティの検査の違反が0件',
    async (width) => {
      applyColorScheme(scheme);
      await page.viewport(width, VIEWPORT_HEIGHT);
      await renderPage(tournamentBracketOf());
      await expect.element(autoRefreshSwitch()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test.each([COLUMNS_WIDTH, TABS_WIDTH])(
    '終了したトーナメントは、画面幅%ipxでアクセシビリティの検査の違反が0件',
    async (width) => {
      applyColorScheme(scheme);
      await page.viewport(width, VIEWPORT_HEIGHT);
      await renderPage(AWARDED_TOURNAMENT_BRACKET);
      await expect.element(awardHeading()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
