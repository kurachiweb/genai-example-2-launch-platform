import { notifyManager } from '@tanstack/react-query';
import { useState } from 'react';
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
  weekMatchOf,
} from './week-board-fixtures.ts';
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

const NEXT_DAY_BOARD: TopPageSectionContext['board'] = Object.freeze({
  date: '2026-11-11',
  phase: 'RESULT',
  serverTime: '2026-11-10T15:00:01.000Z',
});

const WEEK_SECTION: TopPageSection = Object.freeze({
  id: 'tournament-week.matches',
  placement: 'main',
  order: 20,
  component: WeekTournamentSection,
});

function QualifierStandIn() {
  return <p>予選の区画</p>;
}

const QUALIFIER_STAND_IN: TopPageSection = Object.freeze({
  id: 'test.qualifiers',
  placement: 'main',
  order: 30,
  component: QualifierStandIn,
});

const PREVIOUS_WEEK_ROUND = weekBoardRoundOf({
  tournament: {
    week: '2026-W45',
    label: '2026年第45週(11/2〜11/8)',
    firstRoundDate: '2026-11-03',
    finalDate: '2026-11-12',
    status: 'IN_PROGRESS',
    awarded: null,
  },
  round: 8,
  roundName: '準決勝',
  matches: [
    weekMatchOf(11, { round: 8, stage: 'SEMIFINAL' }),
    weekMatchOf(12, { round: 8, stage: 'SEMIFINAL' }),
  ],
  bracketPath: '/tournaments/week/2026-W45',
});

const boardCalls = () =>
  executeGraphQLMock.mock.calls.filter(
    ([document]) => document === ClientWeekTournamentBoardDocument,
  );

const tallyingBoard = (): WeekBoardView =>
  weekBoardOf({
    rounds: [
      weekBoardRoundOf({
        matches: [1, 2].map((n) => weekMatchOf(n, { phase: 'TALLYING' })),
      }),
    ],
  });

const scheduledBoard = (): WeekBoardView =>
  weekBoardOf({
    date: '2026-11-11',
    rounds: [
      weekBoardRoundOf({
        round: 2,
        roundName: '2回戦',
        matches: [3, 4].map((n) =>
          weekMatchOf(n, { round: 2, phase: 'SCHEDULED' }),
        ),
      }),
    ],
  });

const settledBoard = (): WeekBoardView =>
  weekBoardOf({
    rounds: [
      weekBoardRoundOf({
        matches: [1, 2].map((n) =>
          weekMatchOf(n, { phase: 'FINISHED', decision: 'VOTES' }),
        ),
      }),
    ],
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
        : weekBoardResult(next),
    );
  });
};

// 経路が翌日の開始の時刻に予選を取り直して区画の文脈の業務日付を変えることを、ページの外の操作で再現する
function TopPageHost({
  sections,
}: {
  readonly sections: readonly TopPageSection[];
}) {
  const [board, setBoard] = useState(BOARD);
  return (
    <>
      <main className="bg-background text-foreground">
        <TopPage
          sections={sections}
          board={board}
          signedIn={false}
          hasQualifierMatches={false}
        />
      </main>
      <button
        type="button"
        onClick={() => {
          setBoard(NEXT_DAY_BOARD);
        }}
      >
        翌日へ進める
      </button>
    </>
  );
}

const renderPage = async (
  sections: readonly TopPageSection[] = [WEEK_SECTION],
) => {
  // 表示設定は描画の後にブラウザのタイムゾーンとロケールへ合わせ直されるため、ブラウザの側も閲覧者の設定にする
  await emulateBrowserDisplay({ timeZone: 'Asia/Tokyo', locale: 'ja-JP' });
  await renderInMatchFrame(
    <UpvoteBotProtection>
      <TopPageHost sections={sections} />
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
const weekRegions = () =>
  main().getByRole('region', { name: /^Product of the Weekトーナメント/u });
const autoRefreshSwitch = () =>
  main().getByRole('switch', { name: '自動更新' });

const timeOf = (dateTime: string): HTMLTimeElement | null =>
  document.querySelector(`time[datetime="${dateTime}"]`);

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
  applyColorScheme('light');
  await page.viewport(DESKTOP.width, DESKTOP.height);
});

describe('WeekTournamentSectionの見出しと対戦カード', () => {
  test('その日の業務日付の盤面を取得し、見出しにトーナメントの名前・ラウンド名・週の表記・決勝日とブラケットへの導線を置く', async () => {
    respond([weekBoardOf()]);
    await renderPage();

    const region = weekRegions();
    await expect.element(region).toBeVisible();
    await expect
      .element(region.getByRole('heading', { level: 2 }))
      .toHaveTextContent('Product of the Weekトーナメント1回戦');
    await expect
      .element(region.getByText('2026年第46週(11/9〜11/15)', { exact: true }))
      .toBeVisible();
    const finalDate = timeOf('2026-11-17');
    expect(finalDate?.textContent).toMatch(/11月17日$/u);
    expect(finalDate?.parentElement?.textContent).toMatch(/^決勝日/u);
    await expect
      .element(region.getByRole('link', { name: 'ブラケットを見る' }))
      .toHaveAttribute('href', '/tournaments/week/2026-W46');
    expect(boardCalls()).toStrictEqual([
      [
        ClientWeekTournamentBoardDocument,
        { date: WEEK_BOARD_DATE },
        expect.anything(),
      ],
    ]);
  });

  test('対戦カードはマッチの段階と回戦から段階の印を描き、「サイトを開く」をrel="noopener"の別タブで開く', async () => {
    respond([weekBoardOf({ rounds: [PREVIOUS_WEEK_ROUND] })]);
    await renderPage();

    const cards = weekRegions().getByRole('article');
    await expect.element(cards.first()).toBeVisible();
    expect(cards.elements()).toHaveLength(2);
    const [card] = cards.elements();
    expect(card?.textContent).toContain('Week 準決勝');
    const siteLink = cards
      .first()
      .getByRole('link', { name: /^Week Left 11の\s*サイトを開く/u });
    await expect.element(siteLink).toHaveAttribute('rel', 'noopener');
    await expect.element(siteLink).toHaveAttribute('target', '_blank');
  });

  test('画面幅1280px以上は対戦カードを2列に並べる', async () => {
    respond([weekBoardOf()]);
    await renderPage();
    await expect
      .element(weekRegions().getByRole('article').first())
      .toBeVisible();

    const [first, second] = weekRegions().getByRole('article').elements();
    expect(first?.getBoundingClientRect().top).toBe(
      second?.getBoundingClientRect().top,
    );
  });

  test('不戦勝と早期勝利は対戦カードに並べず、末尾の「不戦勝」の一覧に並べ、早期勝利には確定時点のUpvote数を添える', async () => {
    respond([
      weekBoardOf({
        rounds: [
          weekBoardRoundOf({
            matches: [weekMatchOf(1)],
            byes: [
              weekByeOf(1),
              weekByeOf(2, { endedEarly: true, upvoteCount: 15 }),
            ],
          }),
        ],
      }),
    ]);
    await renderPage();

    const region = weekRegions();
    await expect
      .element(region.getByRole('heading', { name: '不戦勝', level: 3 }))
      .toBeVisible();
    const byes = region
      .getByRole('list', { name: '不戦勝' })
      .getByRole('article');
    expect(
      byes.elements().map((bye) => bye.getAttribute('aria-label')),
    ).toStrictEqual(['Week Bye 1(不戦勝)', 'Week Bye 2(不戦勝)']);
    expect(byes.elements()[1]?.textContent).toContain('15票');
    const articles = region.getByRole('article').elements();
    expect(articles.at(-1)?.getAttribute('aria-label')).toBe(
      'Week Bye 2(不戦勝)',
    );
    expect(articles).toHaveLength(3);
  });

  test('重なる2つのトーナメントは、サーバーの順(先に開始されたトーナメントから)に行ごとの区画で並べる', async () => {
    respond([
      weekBoardOf({ rounds: [PREVIOUS_WEEK_ROUND, weekBoardRoundOf()] }),
    ]);
    await renderPage();

    await expect.element(weekRegions().first()).toBeVisible();
    const regions = weekRegions().elements();
    expect(regions).toHaveLength(2);
    expect(regions[0]?.textContent).toContain('2026年第45週(11/2〜11/8)');
    expect(regions[1]?.textContent).toContain('2026年第46週(11/9〜11/15)');
  });

  test('対戦カードのUpvoteは、成功するとサーバーが返したマッチで区画の盤面を取り直さずに更新する', async () => {
    const match = weekMatchOf(1);
    const [left, right] = match.entries;
    const updated: MatchFragment = {
      ...match,
      viewerUpvotedEntryId: left?.id ?? null,
      entries: [
        entryOf('left', { ...left, upvoteCount: 13 }),
        right ?? entryOf('right'),
      ],
    };
    respond(
      [weekBoardOf({ rounds: [weekBoardRoundOf({ matches: [match] })] })],
      updated,
    );
    await renderPage();
    await userEvent.click(
      page.getByRole('button', { name: '判定を成功させる' }),
    );

    await userEvent.click(
      weekRegions().getByRole('button', { name: /^Week Left 1にUpvote/u }),
    );

    await expect
      .element(
        weekRegions().getByRole('button', {
          name: /^Week Left 1へのUpvoteを取り消す/u,
        }),
      )
      .toBeVisible();
    expect(boardCalls()).toHaveLength(1);
  });
});

describe('WeekTournamentSectionを表示しない日', () => {
  test.each([
    ['その日にマッチが無い', EMPTY_WEEK_BOARD],
    [
      'その日のマッチが決勝だけ',
      weekBoardOf({
        rounds: [weekBoardRoundOf({ final: true, roundName: '決勝' })],
      }),
    ],
    [
      '全てのマッチが両者の不戦敗',
      weekBoardOf({ rounds: [weekBoardRoundOf({ matches: [], byes: [] })] }),
    ],
  ] as const)(
    '%s日は区画を描かず、本文の他の区画の間に空きを残さない',
    async (_name, board) => {
      respond([board]);
      await renderPage([WEEK_SECTION, QUALIFIER_STAND_IN]);

      await expect.element(main().getByText('予選の区画')).toBeVisible();
      await expect.poll(() => boardCalls().length).toBe(1);
      await expect.element(weekRegions()).not.toBeInTheDocument();
      await expect.element(autoRefreshSwitch()).not.toBeInTheDocument();
    },
  );
});

describe('WeekTournamentSectionの取得の失敗', () => {
  test('最初の取得に失敗すると、区画の位置だけに失敗の文言と再試行・問い合わせの導線を示し、他の区画の表示を続ける', async () => {
    respond([NETWORK_ERROR, weekBoardOf()]);
    await renderPage([WEEK_SECTION, QUALIFIER_STAND_IN]);

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent('サーバーでエラーが発生しました。');
    await expect
      .element(main().getByRole('link', { name: 'お問い合わせ' }))
      .toHaveAttribute('href', '/contact');
    await expect.element(main().getByText('予選の区画')).toBeVisible();
    await expect.element(weekRegions()).not.toBeInTheDocument();
  });

  test('再試行で取得し直し、成功すると区画を描いて最初の見出しへフォーカスを移す', async () => {
    respond([NETWORK_ERROR, weekBoardOf()]);
    await renderPage([WEEK_SECTION, QUALIFIER_STAND_IN]);

    await userEvent.click(main().getByRole('button', { name: '再試行' }));

    await expect
      .element(weekRegions().getByRole('article').first())
      .toBeVisible();
    await expect
      .element(weekRegions().getByRole('heading', { level: 2 }))
      .toHaveFocus();
    expect(boardCalls()).toHaveLength(2);
  });

  test('取得に失敗すると、この区画の自動更新の申告を消し、ページの自動更新の切り替えを描かない', async () => {
    respond([weekBoardOf(), NETWORK_ERROR]);
    await renderPage([WEEK_SECTION, QUALIFIER_STAND_IN]);
    await expect.element(autoRefreshSwitch()).toBeVisible();

    await userEvent.click(page.getByRole('button', { name: '翌日へ進める' }));

    await expect.element(main().getByRole('alert')).toBeVisible();
    await expect.element(autoRefreshSwitch()).not.toBeInTheDocument();
    await expect.element(main().getByText('予選の区画')).toBeVisible();
    expect(boardCalls().at(-1)?.[1]).toStrictEqual({ date: '2026-11-11' });
  });
});

describe('WeekTournamentSectionの自動更新がオフの間の取り直し', () => {
  const turnOffAutoRefresh = async (): Promise<void> => {
    await userEvent.click(autoRefreshSwitch());
    await expect.element(autoRefreshSwitch()).not.toBeChecked();
  };
  const weekStatus = () => weekRegions().first().getByRole('status');

  test('オフの間はマッチ中の定期の取り直しをせず、終了の時刻の1秒後に盤面を取り直す', async () => {
    startClockAt(BEFORE_FULL_TIME);
    respond([weekBoardOf(), settledBoard()]);
    await renderPage();
    await expect.element(weekRegions()).toBeVisible();
    await turnOffAutoRefresh();

    await vi.advanceTimersByTimeAsync(MINUTE_MS + SECOND_MS - 1);
    expect(boardCalls()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect.poll(() => boardCalls().length).toBe(2);

    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 5);
    expect(boardCalls()).toHaveLength(2);
    await expect.element(weekStatus()).toHaveTextContent('');
  });

  test('境界の直後の盤面が集計中を返し続けると、オフでも境界の取り直しから10回まで取り直し、上限で状態の文を開き直しの案内に切り替える', async () => {
    startClockAt(BEFORE_FULL_TIME);
    respond([weekBoardOf(), tallyingBoard()]);
    await renderPage();
    await expect.element(weekRegions()).toBeVisible();
    await turnOffAutoRefresh();

    await vi.advanceTimersByTimeAsync(MINUTE_MS + SECOND_MS);
    await expect.poll(() => boardCalls().length).toBe(2);
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 8);
    await expect.poll(() => boardCalls().length).toBe(10);
    await expect.element(weekStatus()).toHaveTextContent('');
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS);
    await expect.poll(() => boardCalls().length).toBe(11);

    await expect.element(weekStatus()).toHaveTextContent(FOLLOW_UP_MESSAGE);
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 5);
    expect(boardCalls()).toHaveLength(11);
  });

  test('翌日の盤面が開始の前を返し続けると、オフでも表示した時点から10回まで取り直し、上限で状態の文を開き直しの案内に切り替える', async () => {
    startClockAt(NOON);
    respond([scheduledBoard()]);
    await renderPage();
    await expect.element(weekRegions()).toBeVisible();
    await turnOffAutoRefresh();

    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 9);
    await expect.poll(() => boardCalls().length).toBe(10);
    await expect.element(weekStatus()).toHaveTextContent('');
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS);
    await expect.poll(() => boardCalls().length).toBe(11);

    await expect.element(weekStatus()).toHaveTextContent(FOLLOW_UP_MESSAGE);
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 5);
    expect(boardCalls()).toHaveLength(11);
  });

  test('自動更新がオンの間は、集計中の取り直しが上限を超えても案内を出さない', async () => {
    startClockAt(NOON);
    respond([tallyingBoard()]);
    await renderPage();
    await expect.element(weekRegions()).toBeVisible();

    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 12);

    await expect.poll(() => boardCalls().length).toBe(13);
    await expect.element(weekStatus()).toHaveTextContent('');
  });
});

describe('WeekTournamentSectionの定期の取り直しと自動更新の切り替え', () => {
  test('確定の前の対戦カードがある間は、定期再取得の間隔ごとに取り直し、ページの自動更新の切り替えを描かせる', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    respond([weekBoardOf()]);
    await renderPage();
    await expect.element(autoRefreshSwitch()).toBeVisible();

    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS - 1);
    expect(boardCalls()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect.poll(() => boardCalls().length).toBe(2);
  });

  test('ページ全体の自動更新をオフにすると、定期の取り直しを止める', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    respond([weekBoardOf()]);
    await renderPage();

    await userEvent.click(autoRefreshSwitch());
    await expect.element(autoRefreshSwitch()).not.toBeChecked();
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 3);

    expect(boardCalls()).toHaveLength(1);
  });

  test('対戦カードが全て確定した後は、オンでも取り直さない', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    respond([
      weekBoardOf({
        rounds: [
          weekBoardRoundOf({
            matches: [weekMatchOf(1, { phase: 'FINISHED', decision: 'VOTES' })],
          }),
        ],
      }),
    ]);
    await renderPage();
    await expect.element(weekRegions()).toBeVisible();

    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 3);

    expect(boardCalls()).toHaveLength(1);
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  beforeEach(() => {
    applyColorScheme(scheme);
  });

  test('重なる2つのトーナメントの対戦カードと不戦勝を並べた区画のアクセシビリティの検査の違反が0件', async () => {
    respond([
      weekBoardOf({
        rounds: [
          PREVIOUS_WEEK_ROUND,
          weekBoardRoundOf({
            byes: [weekByeOf(1, { endedEarly: true, upvoteCount: 4 })],
          }),
        ],
      }),
    ]);
    await renderPage();
    await expect
      .element(weekRegions().last().getByRole('heading', { name: '不戦勝' }))
      .toBeVisible();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test('取得の失敗の区画のアクセシビリティの検査の違反が0件', async () => {
    respond([NETWORK_ERROR]);
    await renderPage();
    await expect.element(main().getByRole('alert')).toBeVisible();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
