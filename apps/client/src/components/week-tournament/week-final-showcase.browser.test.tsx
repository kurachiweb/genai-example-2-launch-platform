import { notifyManager } from '@tanstack/react-query';
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
  ClientUpvoteDocument,
  ClientWeekTournamentBoardDocument,
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
import {
  EMPTY_WEEK_BOARD,
  WEEK_BOARD_DATE,
  type WeekBoardView,
  weekBoardOf,
  weekBoardResult,
  weekBoardRoundOf,
  weekByeOf,
  weekFinalRoundOf,
  weekMatchOf,
} from './week-board-fixtures.ts';
import { WeekFinalShowcase } from './week-final-showcase.tsx';
import { WeekTournamentSection } from './week-tournament-section.tsx';

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

const SECOND_MS = 1000;

const MINUTE_MS = 60 * SECOND_MS;

// 業務日付2026-11-10の12:00・23:39(閲覧者のタイムゾーンAsia/Tokyo)。境界は予選の盤面の23:40と翌日の0:00
const NOON = new Date('2026-11-10T03:00:00.000Z');
const BEFORE_FULL_TIME = new Date('2026-11-10T14:39:00.000Z');

const FOLLOW_UP_MESSAGE =
  '結果の反映に時間がかかっています。ページを再読み込みすると最新の状態を表示します。';

const AWARDED_MESSAGE =
  'フルタイム！Week Right 21がProduct of the Weekを受賞🎉';

const NO_AWARD_MESSAGE =
  'フルタイム。0対0で両者敗北。今回の受賞プロダクトはありません';

// 偽のsetTimeoutでTanStack Queryの結果の通知が止まらないよう、テストの後に既定の通知へ戻す
const SYSTEM_NOTIFY_SCHEDULER = (callback: () => void): void => {
  setTimeout(callback, 0);
};

const NETWORK_ERROR = new GraphQLClientError({
  code: 'internal_error',
  message: 'サーバーでエラーが発生しました。',
  status: 500,
});

const BOARD: TopPageSectionContext['board'] = Object.freeze({
  date: WEEK_BOARD_DATE,
  phase: 'RESULT',
  serverTime: '2026-11-10T03:00:00.000Z',
});

const FINAL_SECTION: TopPageSection = Object.freeze({
  id: 'tournament-week.final',
  placement: 'showcase',
  order: 20,
  component: WeekFinalShowcase,
});

const WEEK_SECTION: TopPageSection = Object.freeze({
  id: 'tournament-week.matches',
  placement: 'main',
  order: 20,
  component: WeekTournamentSection,
});

const finalMatchOf = (overrides: Partial<MatchFragment> = {}): MatchFragment =>
  weekMatchOf(21, { round: 8, stage: 'FINAL', ...overrides });

const finalBoardOf = (match: MatchFragment = finalMatchOf()): WeekBoardView =>
  weekBoardOf({ rounds: [weekFinalRoundOf({ matches: [match] })] });

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

const BYE_AWARD_BOARD = weekBoardOf({
  rounds: [
    weekFinalRoundOf({
      matches: [],
      byes: [weekByeOf(1, { round: 8, endedEarly: true, upvoteCount: 7 })],
    }),
  ],
});

const ABSENT_BYE_AWARD_BOARD = weekBoardOf({
  rounds: [
    weekFinalRoundOf({
      matches: [],
      byes: [weekByeOf(1, { round: 8 })],
    }),
  ],
});

const boardCalls = () =>
  executeGraphQLMock.mock.calls.filter(
    ([document]) => document === ClientWeekTournamentBoardDocument,
  );

const qualifierBoardResult = () =>
  Promise.resolve({
    ok: true as const,
    data: {
      qualifierBoard: qualifierBoardOf({
        serverTime: new Date().toISOString(),
      }),
    },
  });

// 区画の取得には盤面を順に返し(最後の盤面は返し続ける)、Upvoteには渡したマッチを返す。
// 境界の時刻は経路のloaderが取得した予選の盤面から読むため、予選の取得には表示の時点の盤面を返す
const respond = (
  boards: readonly (WeekBoardView | GraphQLClientError)[],
  upvoted?: MatchFragment,
) => {
  const queue = [...boards];
  executeGraphQLMock.mockImplementation((document) => {
    if (document === ClientUpvoteDocument && upvoted !== undefined) {
      return Promise.resolve({ ok: true, data: { upvote: upvoted } });
    }
    if (document === ClientQualifierBoardDocument) {
      return qualifierBoardResult();
    }
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next === undefined) {
      throw new Error('盤面の準備に失敗しました');
    }
    return Promise.resolve(
      next instanceof GraphQLClientError
        ? { ok: false, error: next }
        : weekBoardResult(next),
    );
  });
};

const NETWORK_LATENCY_MS = 200;

// 最初の盤面の取得はすぐに返し、以後は通信の時間をおいて返す。同じ時刻に取り直す2つの区画の要求が、通信中に重なるかを確かめる
const respondWithLatency = (first: WeekBoardView, later: WeekBoardView) => {
  let served = 0;
  executeGraphQLMock.mockImplementation((document) => {
    if (document === ClientQualifierBoardDocument) {
      return qualifierBoardResult();
    }
    served += 1;
    return served === 1
      ? Promise.resolve(weekBoardResult(first))
      : new Promise((resolve) => {
          setTimeout(() => {
            resolve(weekBoardResult(later));
          }, NETWORK_LATENCY_MS);
        });
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

const startClockAt = (now: Date): void => {
  notifyManager.setScheduler(queueMicrotask);
  vi.useFakeTimers({
    now,
    toFake: [
      'Date',
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
    ],
  });
};

const main = () => page.getByRole('main');
const finalRegion = () =>
  main().getByRole('region', {
    name: /^Product of the Week\s?トーナメント決勝$/u,
  });
const finalStatus = () => finalRegion().getByRole('status');
const autoRefreshSwitch = () =>
  main().getByRole('switch', { name: '自動更新' });

const all = (selector: string): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>(selector));
const spotlights = () => all('[data-week-final-spotlight]');
const confettiPieces = () => all('[data-week-final-confetti]');
const animationNamesOf = (elements: readonly HTMLElement[]): Set<string> =>
  new Set(elements.map((element) => getComputedStyle(element).animationName));

beforeEach(() => {
  executeGraphQLMock.mockReset();
  vi.mocked(reportUnexpectedErrorInBrowser).mockImplementation(() => undefined);
  resetFakeTurnstile();
});

afterEach(async () => {
  vi.useRealTimers();
  notifyManager.setScheduler(SYSTEM_NOTIFY_SCHEDULER);
  toast.dismiss();
  await emulateBrowserDisplay(null);
  await emulateReducedMotion('no-preference');
  applyColorScheme('light');
  await page.viewport(DESKTOP.width, DESKTOP.height);
});

describe('WeekFinalShowcaseの見出しと決勝の対戦カード', () => {
  test('その日の業務日付の盤面を取得し、「Week Final」の印・「Product of the Week」「トーナメント決勝」の見出し・週の表記を置く', async () => {
    respond([finalBoardOf()]);
    await renderPage();

    const region = finalRegion();
    await expect.element(region).toBeVisible();
    await expect
      .element(region.getByRole('heading', { level: 2 }))
      .toHaveTextContent('Product of the Weekトーナメント決勝');
    await expect
      .element(region.getByText('Week Final', { exact: true }))
      .toBeVisible();
    await expect
      .element(region.getByText('2026年第45週(11/2〜11/8)', { exact: true }))
      .toBeVisible();
    expect(boardCalls()).toStrictEqual([
      [
        ClientWeekTournamentBoardDocument,
        { date: WEEK_BOARD_DATE },
        expect.anything(),
      ],
    ]);
  });

  test('決勝の対戦カードを本文の列ではなくページの全幅で描き、段階の印を「Week 決勝」とする', async () => {
    respond([finalBoardOf()]);
    await renderPage();

    const card = finalRegion().getByRole('article');
    await expect.element(card).toBeVisible();
    const pageWidth = main().element().getBoundingClientRect().width;
    expect(finalRegion().element().getBoundingClientRect().width).toBe(
      pageWidth,
    );
    expect(card.element().getBoundingClientRect().width).toBe(pageWidth);
    expect(card.element().textContent).toContain('Week 決勝');
    const siteLink = card.getByRole('link', {
      name: /^Week Left 21の\s*サイトを開く/u,
    });
    await expect.element(siteLink).toHaveAttribute('rel', 'noopener');
    await expect.element(siteLink).toHaveAttribute('target', '_blank');
  });

  test('決勝のUpvoteは、成功するとサーバーが返したマッチで盤面を取り直さずに更新する', async () => {
    const match = finalMatchOf();
    const [left, right] = match.entries;
    const updated: MatchFragment = {
      ...match,
      viewerUpvotedEntryId: left?.id ?? null,
      entries: [
        entryOf('left', { ...left, upvoteCount: 13 }),
        right ?? entryOf('right'),
      ],
    };
    respond([finalBoardOf(match)], updated);
    await renderPage();
    await userEvent.click(
      page.getByRole('button', { name: '判定を成功させる' }),
    );

    await userEvent.click(
      finalRegion().getByRole('button', { name: /^Week Left 21にUpvote/u }),
    );

    await expect
      .element(
        finalRegion().getByRole('button', {
          name: /^Week Left 21へのUpvoteを取り消す/u,
        }),
      )
      .toBeVisible();
    expect(boardCalls()).toHaveLength(1);
  });
});

describe('WeekFinalShowcaseの確定の後の結果', () => {
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
      'フルタイム！Week Bye 1がProduct of the Weekを受賞🎉',
    ],
  ] as const)(
    '%s決勝は、受賞の文を状態の文として示し、紙吹雪を描く',
    async (_name, board, message) => {
      respond([board]);
      await renderPage();

      await expect.element(finalStatus()).toHaveTextContent(message);
      expect(confettiPieces().length).toBeGreaterThan(0);
    },
  );

  test.each([
    ['早期勝利', BYE_AWARD_BOARD],
    ['対戦相手不在の不戦勝', ABSENT_BYE_AWARD_BOARD],
  ] as const)(
    '%sの決勝は、不戦勝の一覧と次のラウンドへ進む旨を描かず、受賞の文だけで示す',
    async (_name, board) => {
      respond([board]);
      await renderPage();

      await expect
        .element(finalStatus())
        .toHaveTextContent(
          'フルタイム！Week Bye 1がProduct of the Weekを受賞🎉',
        );
      await expect
        .element(finalRegion().getByRole('list', { name: '不戦勝' }))
        .not.toBeInTheDocument();
      expect(finalRegion().element().textContent).not.toContain(
        '次のラウンドへ進みます。',
      );
      expect(finalRegion().getByRole('article').elements()).toHaveLength(0);
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

describe('WeekFinalShowcaseの演出', () => {
  test('自動更新がオンで視差効果を減らす設定でない間は、照明と紙吹雪を動かす', async () => {
    respond([AWARDED_BOARD]);
    await renderPage();
    await expect.element(finalStatus()).toHaveTextContent(AWARDED_MESSAGE);

    expect(spotlights()).toHaveLength(2);
    expect(animationNamesOf(spotlights())).toStrictEqual(
      new Set([
        'week-final-spotlight-sweep',
        'week-final-spotlight-sweep-reverse',
      ]),
    );
    expect(animationNamesOf(confettiPieces())).toStrictEqual(
      new Set(['week-final-confetti-fall']),
    );
    expect(
      confettiPieces().every(
        (piece) => getComputedStyle(piece).display !== 'none',
      ),
    ).toBe(true);
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

describe('WeekFinalShowcaseを表示しない日', () => {
  test.each([
    ['その日にマッチが無い', EMPTY_WEEK_BOARD],
    ['その日のマッチが決勝ではない', weekBoardOf()],
    [
      '決勝が両者の不戦敗',
      weekBoardOf({
        rounds: [weekFinalRoundOf({ matches: [], byes: [] })],
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

describe('WeekFinalShowcaseの取得の失敗', () => {
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

describe('WeekFinalShowcaseの取り直し', () => {
  test('決勝のマッチ中は、定期再取得の間隔ごとに取り直し、ページの自動更新の切り替えを描かせる', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    respond([finalBoardOf()]);
    await renderPage();
    await expect.element(autoRefreshSwitch()).toBeVisible();

    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS - 1);
    expect(boardCalls()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect.poll(() => boardCalls().length).toBe(2);
  });

  test('確定した後は、照明の演出のために切り替えを描かせたまま、オンでも取り直さない', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    respond([AWARDED_BOARD]);
    await renderPage();
    await expect.element(autoRefreshSwitch()).toBeVisible();

    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 3);

    expect(boardCalls()).toHaveLength(1);
  });

  test('本文のWeekトーナメントの区画と同じ盤面を描く日は、定期の取り直しを重ねず1回ずつ取り直す', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    respond([
      weekBoardOf({ rounds: [weekBoardRoundOf(), weekFinalRoundOf()] }),
    ]);
    await renderPage([FINAL_SECTION, WEEK_SECTION]);
    await expect.element(finalRegion()).toBeVisible();
    await expect
      .element(
        main().getByRole('region', {
          name: /^Product of the Weekトーナメント\s?1回戦$/u,
        }),
      )
      .toBeVisible();
    expect(boardCalls()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS);
    await expect.poll(() => boardCalls().length).toBe(2);
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 2);

    await expect.poll(() => boardCalls().length).toBe(4);
  });

  test('本文のWeekトーナメントの区画と同じ盤面を描く日は、終了の時刻の境界でも1回だけ取り直す', async () => {
    startClockAt(BEFORE_FULL_TIME);
    respondWithLatency(
      weekBoardOf({ rounds: [weekBoardRoundOf(), weekFinalRoundOf()] }),
      weekBoardOf({
        rounds: [
          weekBoardRoundOf({
            matches: [weekMatchOf(1, { phase: 'FINISHED', decision: 'VOTES' })],
          }),
          weekFinalRoundOf({ matches: [decidedFinalOf('VOTES')] }),
        ],
      }),
    );
    await renderPage([FINAL_SECTION, WEEK_SECTION]);
    await expect.element(finalRegion()).toBeVisible();
    await userEvent.click(autoRefreshSwitch());
    await expect.element(autoRefreshSwitch()).not.toBeChecked();

    await vi.advanceTimersByTimeAsync(MINUTE_MS + SECOND_MS);
    await vi.advanceTimersByTimeAsync(NETWORK_LATENCY_MS);

    await expect.element(finalStatus()).toHaveTextContent(AWARDED_MESSAGE);
    await vi.advanceTimersByTimeAsync(SECOND_MS);
    expect(boardCalls()).toHaveLength(2);
  });

  test('決勝の結果の確定を待つ間は、オフでも表示した時点から10回まで取り直し、上限で状態の文を開き直しの案内に切り替える', async () => {
    startClockAt(NOON);
    respond([finalBoardOf(finalMatchOf({ phase: 'TALLYING' }))]);
    await renderPage();
    await expect.element(finalRegion()).toBeVisible();
    await userEvent.click(autoRefreshSwitch());
    await expect.element(autoRefreshSwitch()).not.toBeChecked();

    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 9);
    await expect.poll(() => boardCalls().length).toBe(10);
    await expect.element(finalStatus()).toHaveTextContent('');
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS);
    await expect.poll(() => boardCalls().length).toBe(11);

    await expect.element(finalStatus()).toHaveTextContent(FOLLOW_UP_MESSAGE);
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 5);
    expect(boardCalls()).toHaveLength(11);
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  beforeEach(() => {
    applyColorScheme(scheme);
  });

  test.each([
    ['マッチ中', finalBoardOf()],
    ['受賞', AWARDED_BOARD],
    ['受賞なし', NO_AWARD_BOARD],
  ] as const)(
    '%sの決勝の区画のアクセシビリティの検査の違反が0件',
    async (_name, board) => {
      respond([board]);
      await renderPage();
      await expect.element(finalRegion().getByRole('article')).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test('不戦勝・早期勝利で受賞した決勝の区画のアクセシビリティの検査の違反が0件', async () => {
    respond([BYE_AWARD_BOARD]);
    await renderPage();
    await expect
      .element(finalStatus())
      .toHaveTextContent('フルタイム！Week Bye 1がProduct of the Weekを受賞🎉');

    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
