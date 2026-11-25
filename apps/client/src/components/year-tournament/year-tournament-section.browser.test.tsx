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
import {
  EMPTY_YEAR_BOARD,
  YEAR_BOARD_DATE,
  type YearBoardView,
  yearBoardOf,
  yearBoardResult,
  yearBoardRoundOf,
  yearByeOf,
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

const NETWORK_ERROR = new GraphQLClientError({
  code: 'internal_error',
  message: 'サーバーでエラーが発生しました。',
  status: 500,
});

const BOARD: TopPageSectionContext['board'] = Object.freeze({
  date: YEAR_BOARD_DATE,
  phase: 'RESULT',
  serverTime: '2027-05-27T03:00:00.000Z',
});

const YEAR_SECTION: TopPageSection = Object.freeze({
  id: 'tournament-year.matches',
  placement: 'main',
  order: 10,
  component: YearTournamentSection,
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

const SEMIFINAL_ROUND = yearBoardRoundOf({
  round: 2,
  roundName: '準決勝',
  matches: [
    yearMatchOf(11, { round: 2, stage: 'SEMIFINAL' }),
    yearMatchOf(12, { round: 2, stage: 'SEMIFINAL' }),
  ],
});

const boardCalls = () =>
  executeGraphQLMock.mock.calls.filter(
    ([document]) => document === ClientYearTournamentBoardDocument,
  );

// 区画の取得には盤面を順に返し(最後の盤面は返し続ける)、Upvoteには渡したマッチを返す。
// 境界の時刻は経路のloaderが取得した予選の盤面から読むため、予選の取得には表示の時点の盤面を返す
const respond = (
  boards: readonly (YearBoardView | GraphQLClientError)[],
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
        : yearBoardResult(next),
    );
  });
};

const renderPage = async (
  sections: readonly TopPageSection[] = [YEAR_SECTION],
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
const yearRegions = () =>
  main().getByRole('region', { name: /^Product of the Yearトーナメント/u });
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
  await emulateBrowserDisplay(null);
  applyColorScheme('light');
  await page.viewport(DESKTOP.width, DESKTOP.height);
});

describe('YearTournamentSectionの見出しと対戦カード', () => {
  test('その日の業務日付の盤面を取得し、見出しに「Product of the Yearトーナメント」・ラウンド名・対象年・決勝日とブラケットへの通常のリンクを置く', async () => {
    respond([yearBoardOf()]);
    await renderPage();

    const region = yearRegions();
    await expect.element(region).toBeVisible();
    await expect
      .element(region.getByRole('heading', { level: 2 }))
      .toHaveTextContent('Product of the Yearトーナメント1回戦');
    await expect
      .element(region.getByText('2027年', { exact: true }))
      .toBeVisible();
    const finalDate = timeOf('2027-05-30');
    expect(finalDate?.textContent).toMatch(/5月30日$/u);
    expect(finalDate?.parentElement?.textContent).toMatch(/^決勝日/u);
    const link = region.getByRole('link', { name: 'ブラケットを見る' });
    await expect
      .element(link)
      .toHaveAttribute('href', '/tournaments/year/2027');
    expect(link.element().getAttribute('target')).toBeNull();
    expect(boardCalls()).toStrictEqual([
      [
        ClientYearTournamentBoardDocument,
        { date: YEAR_BOARD_DATE },
        expect.anything(),
      ],
    ]);
  });

  test('ラウンドの遅れの後は、見出しの決勝日に行の遅らせた後の日を示す', async () => {
    respond([
      yearBoardOf({ rounds: [yearBoardRoundOf({ finalDate: '2027-05-31' })] }),
    ]);
    await renderPage();

    await expect.element(yearRegions()).toBeVisible();
    expect(timeOf('2027-05-31')?.textContent).toMatch(/5月31日$/u);
    expect(timeOf('2027-05-30')).toBeNull();
  });

  test('対戦カードはYearの段階の印を描き、「サイトを開く」をrel="noopener"の別タブで開く', async () => {
    respond([yearBoardOf({ rounds: [SEMIFINAL_ROUND] })]);
    await renderPage();

    const cards = yearRegions().getByRole('article');
    await expect.element(cards.first()).toBeVisible();
    expect(cards.elements()).toHaveLength(2);
    expect(cards.elements()[0]?.textContent).toContain('Year 準決勝');
    const siteLink = cards
      .first()
      .getByRole('link', { name: /^Year Left 11の\s*サイトを開く/u });
    await expect.element(siteLink).toHaveAttribute('rel', 'noopener');
    await expect.element(siteLink).toHaveAttribute('target', '_blank');
  });

  test('画面幅1280px以上は対戦カードを2列に並べる', async () => {
    respond([yearBoardOf()]);
    await renderPage();
    await expect
      .element(yearRegions().getByRole('article').first())
      .toBeVisible();

    const [first, second] = yearRegions().getByRole('article').elements();
    expect(first?.getBoundingClientRect().top).toBe(
      second?.getBoundingClientRect().top,
    );
  });

  test('不戦勝と早期勝利は対戦カードに並べず、末尾の「不戦勝」の一覧に並べ、早期勝利には確定時点のUpvote数を添える', async () => {
    respond([
      yearBoardOf({
        rounds: [
          yearBoardRoundOf({
            matches: [yearMatchOf(1)],
            byes: [
              yearByeOf(1),
              yearByeOf(2, { endedEarly: true, upvoteCount: 15 }),
            ],
          }),
        ],
      }),
    ]);
    await renderPage();

    const region = yearRegions();
    await expect
      .element(region.getByRole('heading', { name: '不戦勝', level: 3 }))
      .toBeVisible();
    const byes = region
      .getByRole('list', { name: '不戦勝' })
      .getByRole('article');
    expect(
      byes.elements().map((bye) => bye.getAttribute('aria-label')),
    ).toStrictEqual(['Year Bye 1(不戦勝)', 'Year Bye 2(不戦勝)']);
    expect(byes.elements()[1]?.textContent).toContain('15票');
    const articles = region.getByRole('article').elements();
    expect(articles.at(-1)?.getAttribute('aria-label')).toBe(
      'Year Bye 2(不戦勝)',
    );
    expect(articles).toHaveLength(3);
  });

  test('対戦カードのUpvoteは、成功するとサーバーが返したマッチで区画の盤面を取り直さずに更新する', async () => {
    const match = yearMatchOf(1);
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
      [yearBoardOf({ rounds: [yearBoardRoundOf({ matches: [match] })] })],
      updated,
    );
    await renderPage();
    await userEvent.click(
      page.getByRole('button', { name: '判定を成功させる' }),
    );

    await userEvent.click(
      yearRegions().getByRole('button', { name: /^Year Left 1にUpvote/u }),
    );

    await expect
      .element(
        yearRegions().getByRole('button', {
          name: /^Year Left 1へのUpvoteを取り消す/u,
        }),
      )
      .toBeVisible();
    expect(boardCalls()).toHaveLength(1);
  });

  test('本文の区画の順は10のため、Weekトーナメント(20)と予選(30)の区画より上に描く', async () => {
    function WeekStandIn() {
      return <p>Weekの区画</p>;
    }
    respond([yearBoardOf()]);
    await renderPage([
      QUALIFIER_STAND_IN,
      {
        id: 'test.week',
        placement: 'main',
        order: 20,
        component: WeekStandIn,
      },
      YEAR_SECTION,
    ]);

    await expect.element(yearRegions()).toBeVisible();
    const year = yearRegions().element();
    const week = main().getByText('Weekの区画').element();
    const qualifier = main().getByText('予選の区画').element();
    expect(
      year.compareDocumentPosition(week) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      week.compareDocumentPosition(qualifier) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe('YearTournamentSectionを表示しない日', () => {
  test.each([
    ['その日にマッチが無い', EMPTY_YEAR_BOARD],
    ['その日のマッチが決勝だけ', yearBoardOf({ rounds: [yearFinalRoundOf()] })],
    [
      '全てのマッチが両者の不戦敗',
      yearBoardOf({ rounds: [yearBoardRoundOf({ matches: [], byes: [] })] }),
    ],
  ] as const)(
    '%s日は区画を描かず、本文の他の区画の間に空きを残さない',
    async (_name, board) => {
      respond([board]);
      await renderPage([YEAR_SECTION, QUALIFIER_STAND_IN]);

      await expect.element(main().getByText('予選の区画')).toBeVisible();
      await expect.poll(() => boardCalls().length).toBe(1);
      await expect.element(yearRegions()).not.toBeInTheDocument();
      await expect.element(autoRefreshSwitch()).not.toBeInTheDocument();
    },
  );
});

describe('YearTournamentSectionの取得の失敗', () => {
  test('最初の取得に失敗すると、区画の位置だけに失敗の文言と再試行・問い合わせの導線を示し、他の区画の表示を続ける', async () => {
    respond([NETWORK_ERROR, yearBoardOf()]);
    await renderPage([YEAR_SECTION, QUALIFIER_STAND_IN]);

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent('サーバーでエラーが発生しました。');
    await expect
      .element(main().getByRole('link', { name: 'お問い合わせ' }))
      .toHaveAttribute('href', '/contact');
    await expect.element(main().getByText('予選の区画')).toBeVisible();
    await expect.element(yearRegions()).not.toBeInTheDocument();
  });

  test('再試行で取得し直し、成功すると区画を描いて最初の見出しへフォーカスを移す', async () => {
    respond([NETWORK_ERROR, yearBoardOf()]);
    await renderPage([YEAR_SECTION, QUALIFIER_STAND_IN]);

    await userEvent.click(main().getByRole('button', { name: '再試行' }));

    await expect
      .element(yearRegions().getByRole('article').first())
      .toBeVisible();
    await expect
      .element(yearRegions().getByRole('heading', { level: 2 }))
      .toHaveFocus();
    expect(boardCalls()).toHaveLength(2);
  });
});

describe('YearTournamentSectionの定期の取り直しと自動更新の切り替え', () => {
  test('確定の前の対戦カードがある間は、定期再取得の間隔ごとに取り直し、ページの自動更新の切り替えを描かせる', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    respond([yearBoardOf()]);
    await renderPage();
    await expect.element(autoRefreshSwitch()).toBeVisible();

    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS - 1);
    expect(boardCalls()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect.poll(() => boardCalls().length).toBe(2);
  });

  test('ページ全体の自動更新をオフにすると、定期の取り直しを止める', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    respond([yearBoardOf()]);
    await renderPage();

    await userEvent.click(autoRefreshSwitch());
    await expect.element(autoRefreshSwitch()).not.toBeChecked();
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 3);

    expect(boardCalls()).toHaveLength(1);
  });

  test('対戦カードが全て確定した後は、オンでも取り直さない', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    respond([
      yearBoardOf({
        rounds: [
          yearBoardRoundOf({
            matches: [yearMatchOf(1, { phase: 'FINISHED', decision: 'VOTES' })],
          }),
        ],
      }),
    ]);
    await renderPage();
    await expect.element(yearRegions()).toBeVisible();

    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 3);

    expect(boardCalls()).toHaveLength(1);
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  beforeEach(() => {
    applyColorScheme(scheme);
  });

  test('対戦カードと不戦勝を並べた区画のアクセシビリティの検査の違反が0件', async () => {
    respond([
      yearBoardOf({
        rounds: [
          yearBoardRoundOf({
            byes: [yearByeOf(1, { endedEarly: true, upvoteCount: 4 })],
          }),
        ],
      }),
    ]);
    await renderPage();
    await expect
      .element(yearRegions().getByRole('heading', { name: '不戦勝' }))
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
