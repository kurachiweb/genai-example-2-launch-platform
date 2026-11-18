import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { reportUnexpectedErrorInBrowser } from '../../../lib/start/observability/browser-error-reporting.ts';
import { executeGraphQL } from '../../../lib/start/graphql/execute-graphql.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import { resetFakeTurnstile } from '../../../lib/test/fake-turnstile.tsx';
import { emulateReducedMotion } from '../../../lib/test/reduced-motion.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { LIVE_REFRESH_INTERVAL_MS } from '../../../lib/utilities/query/live-refresh.ts';
import {
  ClientQualifierBoardDocument,
  ClientYearTournamentBoardDocument,
  type MatchFragment,
} from '../../graphql/generated/graphql.ts';
import { entryOf } from '../match/match-fixtures.ts';
import { renderInMatchFrame } from '../match/match-testing.tsx';
import { UpvoteBotProtection } from '../match/upvote-bot-protection.tsx';
import { qualifierBoardOf } from '../top/qualifier-board-fixtures.ts';
import { TopPage } from '../top/top-page.tsx';
import type {
  TopPageSection,
  TopPageSectionContext,
} from '../top/top-page-section-types.ts';
import { YearFinalShowcase } from './year-final-showcase.tsx';
import {
  EMPTY_YEAR_BOARD,
  YEAR_FINAL_DATE,
  type YearBoardView,
  yearBoardOf,
  yearBoardResult,
  yearBoardRoundOf,
  yearByeOf,
  yearFinalBoardOf,
  yearFinalRoundOf,
  yearMatchOf,
} from './year-tournament-fixtures.ts';
import { YearTournamentSection } from './year-tournament-section.tsx';

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../../../lib/test/fake-turnstile.tsx'),
);

vi.mock('../../../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

const executeGraphQLMock = vi.mocked(executeGraphQL);

const DESKTOP = { width: 1280, height: 900 } as const;

const AWARDED_MESSAGE =
  'フルタイム！Year Right 21がProduct of the Yearを受賞🎉';

const NO_AWARD_MESSAGE =
  'フルタイム。0対0で両者敗北。今回の受賞プロダクトはありません';

const NETWORK_ERROR = new GraphQLClientError({
  code: 'internal_error',
  message: 'サーバーでエラーが発生しました。',
  status: 500,
});

const BOARD: TopPageSectionContext['board'] = Object.freeze({
  date: YEAR_FINAL_DATE,
  phase: 'RESULT',
  serverTime: '2027-05-30T03:00:00.000Z',
});

const FINAL_SECTION: TopPageSection = Object.freeze({
  id: 'tournament-year.final',
  placement: 'showcase',
  order: 10,
  component: YearFinalShowcase,
});

const YEAR_SECTION: TopPageSection = Object.freeze({
  id: 'tournament-year.matches',
  placement: 'main',
  order: 10,
  component: YearTournamentSection,
});

const finalMatchOf = (overrides: Partial<MatchFragment> = {}): MatchFragment =>
  yearMatchOf(21, { round: 3, stage: 'FINAL', ...overrides });

const finalBoardOf = (match: MatchFragment = finalMatchOf()): YearBoardView =>
  yearFinalBoardOf({ rounds: [yearFinalRoundOf({ matches: [match] })] });

const decidedFinalOf = (decision: 'VOTES' | 'NO_VOTES'): MatchFragment => {
  const match = finalMatchOf({ phase: 'FINISHED', decision });
  const [left, right] = match.entries;
  return {
    ...match,
    entries: [
      entryOf('left', { ...left, result: 'LOST' }),
      entryOf('right', {
        ...right,
        result: decision === 'VOTES' ? 'WON' : 'LOST',
      }),
    ],
  };
};

const AWARDED_BOARD = finalBoardOf(decidedFinalOf('VOTES'));

const NO_AWARD_BOARD = finalBoardOf(decidedFinalOf('NO_VOTES'));

const BYE_AWARD_BOARD = yearFinalBoardOf({
  rounds: [
    yearFinalRoundOf({
      matches: [],
      byes: [yearByeOf(1, { round: 3, endedEarly: true, upvoteCount: 7 })],
    }),
  ],
});

const boardCalls = () =>
  executeGraphQLMock.mock.calls.filter(
    ([document]) => document === ClientYearTournamentBoardDocument,
  );

// 区画の取得には盤面を順に返す(最後の盤面は返し続ける)。境界の時刻は経路のloaderが取得した予選の盤面から読むため、予選の取得には表示の時点の盤面を返す
const respond = (boards: readonly (YearBoardView | GraphQLClientError)[]) => {
  const queue = [...boards];
  executeGraphQLMock.mockImplementation((document) => {
    if (document === ClientQualifierBoardDocument) {
      return Promise.resolve({
        ok: true,
        data: {
          qualifierBoard: qualifierBoardOf({
            serverTime: new Date().toISOString(),
          }),
        },
      });
    }
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next === undefined) {
      throw new Error('盤面の準備に失敗しました');
    }
    return Promise.resolve(
      next instanceof GraphQLClientError
        ? { ok: false, error: next }
        : yearBoardResult(next),
    );
  });
};

const renderPage = async (
  sections: readonly TopPageSection[] = [FINAL_SECTION],
) => {
  // 表示設定は描画の後にブラウザのタイムゾーンとロケールへ合わせ直されるため、ブラウザの側も閲覧者の設定にする
  await emulateBrowserDisplay({ timeZone: 'Asia/Tokyo', locale: 'ja-JP' });
  await renderInMatchFrame(
    <UpvoteBotProtection>
      <main className="bg-background text-foreground">
        <TopPage
          sections={sections}
          board={BOARD}
          signedIn={false}
          hasQualifierMatches={false}
        />
      </main>
    </UpvoteBotProtection>,
    { host: 'none' },
  );
};

const main = () => page.getByRole('main');
const finalRegion = () =>
  main().getByRole('region', {
    name: /^Product of the Year\s?トーナメント決勝$/u,
  });
const finalStatus = () => finalRegion().getByRole('status');
const autoRefreshSwitch = () =>
  main().getByRole('switch', { name: '自動更新' });

const all = (selector: string): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>(selector));
const spotlights = () => all('[data-tournament-final-spotlight]');
const confettiPieces = () => all('[data-tournament-final-confetti]');
const animationNamesOf = (elements: readonly HTMLElement[]): Set<string> =>
  new Set(elements.map((element) => getComputedStyle(element).animationName));

beforeEach(() => {
  executeGraphQLMock.mockReset();
  vi.mocked(reportUnexpectedErrorInBrowser).mockImplementation(() => undefined);
  resetFakeTurnstile();
});

afterEach(async () => {
  vi.useRealTimers();
  toast.dismiss();
  await emulateBrowserDisplay(null);
  await emulateReducedMotion('no-preference');
  applyColorScheme('light');
  await page.viewport(DESKTOP.width, DESKTOP.height);
});

describe('YearFinalShowcaseの見出しと決勝の対戦カード', () => {
  test('その日の業務日付の盤面を取得し、「Year Final」の印・「Product of the Year」「トーナメント決勝」の見出し・対象年の表記とブラケットへのリンクを置く', async () => {
    respond([finalBoardOf()]);
    await renderPage();

    const region = finalRegion();
    await expect.element(region).toBeVisible();
    await expect
      .element(region.getByRole('heading', { level: 2 }))
      .toHaveTextContent('Product of the Yearトーナメント決勝');
    await expect
      .element(region.getByText('Year Final', { exact: true }))
      .toBeVisible();
    await expect
      .element(region.getByText('2027年', { exact: true }))
      .toBeVisible();
    await expect
      .element(region.getByRole('link', { name: 'ブラケットを見る' }))
      .toHaveAttribute('href', '/tournaments/year/2027');
    expect(boardCalls()).toStrictEqual([
      [
        ClientYearTournamentBoardDocument,
        { date: YEAR_FINAL_DATE },
        expect.anything(),
      ],
    ]);
  });

  test('決勝の対戦カードを本文の列ではなくページの全幅で描き、段階の印を「Year 決勝」とする', async () => {
    respond([finalBoardOf()]);
    await renderPage();

    const card = finalRegion().getByRole('article');
    await expect.element(card).toBeVisible();
    const pageWidth = main().element().getBoundingClientRect().width;
    expect(finalRegion().element().getBoundingClientRect().width).toBe(
      pageWidth,
    );
    expect(card.element().getBoundingClientRect().width).toBe(pageWidth);
    expect(card.element().textContent).toContain('Year 決勝');
    await expect
      .element(
        card.getByRole('link', { name: /^Year Left 21の\s*サイトを開く/u }),
      )
      .toHaveAttribute('rel', 'noopener');
  });

  test('本文のYearトーナメントの区画と同じ盤面を購読し、決勝の行だけを全幅で描いて本文には決勝を描かない', async () => {
    respond([
      yearFinalBoardOf({
        rounds: [
          yearBoardRoundOf({ round: 2, roundName: '準決勝' }),
          yearFinalRoundOf(),
        ],
      }),
    ]);
    await renderPage([FINAL_SECTION, YEAR_SECTION]);

    await expect.element(finalRegion().getByRole('article')).toBeVisible();
    await expect
      .element(
        main().getByRole('region', {
          name: /^Product of the Yearトーナメント\s?準決勝$/u,
        }),
      )
      .toBeVisible();
    expect(finalRegion().getByRole('article').elements()).toHaveLength(1);
    expect(main().getByRole('article').elements()).toHaveLength(3);
    expect(boardCalls()).toHaveLength(1);
  });
});

describe('YearFinalShowcaseの確定の後の結果', () => {
  test('確定の前は状態の領域を空のまま置き、紙吹雪を描かない', async () => {
    respond([finalBoardOf()]);
    await renderPage();

    await expect.element(finalStatus()).toHaveTextContent('');
    expect(confettiPieces()).toHaveLength(0);
  });

  test.each([
    ['勝った側が受賞した', AWARDED_BOARD, AWARDED_MESSAGE],
    [
      '早期勝利の側が受賞した',
      BYE_AWARD_BOARD,
      'フルタイム！Year Bye 1がProduct of the Yearを受賞🎉',
    ],
  ] as const)(
    '%s決勝は、Yearの受賞の文を状態の文として示し、紙吹雪を描く',
    async (_name, board, message) => {
      respond([board]);
      await renderPage();

      await expect.element(finalStatus()).toHaveTextContent(message);
      expect(confettiPieces().length).toBeGreaterThan(0);
    },
  );

  test('0対0で両者敗北した決勝は、受賞なしの文を状態の文として示し、紙吹雪を描かない', async () => {
    respond([NO_AWARD_BOARD]);
    await renderPage();

    await expect.element(finalStatus()).toHaveTextContent(NO_AWARD_MESSAGE);
    expect(confettiPieces()).toHaveLength(0);
  });

  test('マッチ中に確定の結果を取り直すと、空の状態の領域に受賞の文を加える', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    respond([finalBoardOf(), AWARDED_BOARD]);
    await renderPage();
    await expect.element(finalStatus()).toHaveTextContent('');

    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS);

    await expect.element(finalStatus()).toHaveTextContent(AWARDED_MESSAGE);
  });
});

describe('YearFinalShowcaseの演出', () => {
  test('自動更新がオンで視差効果を減らす設定でない間は、照明と紙吹雪を動かす', async () => {
    respond([AWARDED_BOARD]);
    await renderPage();
    await expect.element(finalStatus()).toHaveTextContent(AWARDED_MESSAGE);

    expect(spotlights()).toHaveLength(2);
    expect(animationNamesOf(spotlights())).toStrictEqual(
      new Set([
        'tournament-final-spotlight-sweep',
        'tournament-final-spotlight-sweep-reverse',
      ]),
    );
    expect(animationNamesOf(confettiPieces())).toStrictEqual(
      new Set(['tournament-final-confetti-fall']),
    );
  });

  test('視差効果を減らす設定では、照明を止めて紙吹雪を隠し、受賞は文で伝える', async () => {
    await emulateReducedMotion('reduce');
    respond([AWARDED_BOARD]);
    await renderPage();
    await expect.element(finalStatus()).toHaveTextContent(AWARDED_MESSAGE);

    expect(animationNamesOf(spotlights())).toStrictEqual(new Set(['none']));
    expect(
      confettiPieces().every(
        (piece) => getComputedStyle(piece).display === 'none',
      ),
    ).toBe(true);
  });

  test('ページの自動更新をオフにすると、照明を止めて紙吹雪を隠す', async () => {
    respond([AWARDED_BOARD]);
    await renderPage();
    await expect.element(autoRefreshSwitch()).toBeVisible();

    await userEvent.click(autoRefreshSwitch());
    await expect.element(autoRefreshSwitch()).not.toBeChecked();

    expect(animationNamesOf(spotlights())).toStrictEqual(new Set(['none']));
    expect(
      confettiPieces().every(
        (piece) => getComputedStyle(piece).display === 'none',
      ),
    ).toBe(true);
  });
});

describe('YearFinalShowcaseを表示しない日', () => {
  test.each([
    ['その日にマッチが無い', EMPTY_YEAR_BOARD],
    ['その日のマッチが決勝ではない', yearBoardOf()],
    [
      '決勝が両者の不戦敗',
      yearFinalBoardOf({
        rounds: [yearFinalRoundOf({ matches: [], byes: [] })],
      }),
    ],
  ] as const)(
    '%s日は区画を描かず、ページの自動更新の切り替えを描かせない',
    async (_name, board) => {
      respond([board]);
      await renderPage();

      await expect.poll(() => boardCalls().length).toBe(1);
      await expect.element(finalRegion()).not.toBeInTheDocument();
      await expect.element(autoRefreshSwitch()).not.toBeInTheDocument();
      expect(spotlights()).toHaveLength(0);
    },
  );
});

describe('YearFinalShowcaseの取得の失敗', () => {
  test('取得に失敗すると、区画の位置だけに失敗の文言と再試行の導線を示す', async () => {
    respond([NETWORK_ERROR, finalBoardOf()]);
    await renderPage();

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent('サーバーでエラーが発生しました。');
    await expect.element(finalRegion()).not.toBeInTheDocument();

    await userEvent.click(main().getByRole('button', { name: '再試行' }));

    await expect.element(finalRegion().getByRole('article')).toBeVisible();
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  beforeEach(() => {
    applyColorScheme(scheme);
  });

  test.each([
    ['マッチ中', finalBoardOf(), ''],
    ['受賞', AWARDED_BOARD, AWARDED_MESSAGE],
    ['受賞なし', NO_AWARD_BOARD, NO_AWARD_MESSAGE],
  ] as const)(
    '%sの決勝の区画のアクセシビリティの検査の違反が0件',
    async (_name, board, message) => {
      respond([board]);
      await renderPage();
      await expect.element(finalRegion().getByRole('article')).toBeVisible();
      await expect.element(finalStatus()).toHaveTextContent(message);

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
