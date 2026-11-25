import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import { resetFakeTurnstile } from '../../../lib/test/fake-turnstile.tsx';
import {
  ClientUpvoteDocument,
  type MatchFragment,
} from '../../graphql/generated/graphql.ts';
import { entryOf } from '../match/match-fixtures.ts';
import { renderInMatchFrame } from '../match/match-testing.tsx';
import { UpvoteBotProtection } from '../match/upvote-bot-protection.tsx';
import {
  type BoardRoundFixture,
  boardByeOf,
  boardMatchOf,
  boardRoundOf,
  SECTION_TITLE,
} from './tournament-board-fixtures.ts';
import { YEAR_BOARD_COPY } from '../year-tournament/year-tournament-messages.ts';
import {
  YEAR_BRACKET_PATH,
  YEAR_TOURNAMENT_LABEL,
} from '../year-tournament/year-tournament-fixtures.ts';
import { splitBoardRound } from './tournament-board-model.ts';
import { TournamentBoardRound } from './tournament-board-round.tsx';
import { TournamentSectionHeading } from './tournament-section-heading.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../../../lib/test/fake-turnstile.tsx'),
);

const DESKTOP = { width: 1280, height: 900 } as const;

const renderRound = async (
  round: BoardRoundFixture = boardRoundOf(),
  {
    statusMessage,
    title = SECTION_TITLE,
  }: { readonly statusMessage?: string | null; readonly title?: string } = {},
) => {
  const onUpdated = vi.fn<(match: MatchFragment) => void>();
  await emulateBrowserDisplay({ timeZone: 'Asia/Tokyo', locale: 'ja-JP' });
  await renderInMatchFrame(
    <UpvoteBotProtection>
      <main className="bg-background text-foreground">
        <TournamentBoardRound
          row={splitBoardRound(round)}
          onUpdated={onUpdated}
          statusMessage={statusMessage}
        >
          {(headingId) => (
            <TournamentSectionHeading
              id={headingId}
              title={title}
              roundName={round.roundName}
              periodLabel={round.periodLabel}
              finalDate={round.finalDate}
              bracketPath={round.bracketPath}
            />
          )}
        </TournamentBoardRound>
      </main>
    </UpvoteBotProtection>,
    { width: DESKTOP.width },
  );
  return { onUpdated };
};

const region = (title: string = SECTION_TITLE) =>
  page.getByRole('region', { name: new RegExp(`^${title}`, 'u') });

const timeOf = (dateTime: string): HTMLTimeElement | null =>
  document.querySelector(`time[datetime="${dateTime}"]`);

beforeEach(() => {
  executeGraphQL.mockReset();
  resetFakeTurnstile();
});

afterEach(async () => {
  await emulateBrowserDisplay(null);
  applyColorScheme('light');
  await page.viewport(DESKTOP.width, DESKTOP.height);
});

describe('TournamentBoardRoundとTournamentSectionHeadingの見出し', () => {
  test('見出しに区画の名前とラウンド名を置き、期間の表記・決勝日・ブラケットへの通常のリンクを並べ、区画の名前にする', async () => {
    await renderRound();

    await expect.element(region()).toBeVisible();
    await expect
      .element(region().getByRole('heading', { level: 2 }))
      .toHaveTextContent(`${SECTION_TITLE}1回戦`);
    await expect
      .element(region().getByText('2026年第46週(11/9〜11/15)', { exact: true }))
      .toBeVisible();
    const finalDate = timeOf('2026-11-17');
    expect(finalDate?.textContent).toMatch(/11月17日$/u);
    expect(finalDate?.parentElement?.textContent).toMatch(/^決勝日/u);
    const link = region().getByRole('link', { name: 'ブラケットを見る' });
    await expect
      .element(link)
      .toHaveAttribute('href', '/tournaments/test/current');
    expect(link.element().getAttribute('target')).toBeNull();
  });

  test('決勝日が無い行は、決勝日の表記を置かない', async () => {
    await renderRound(boardRoundOf({ finalDate: null }));

    await expect.element(region()).toBeVisible();
    expect(region().element().textContent).not.toContain('決勝日');
    expect(document.querySelector('time')).toBeNull();
  });
});

describe('TournamentBoardRoundの対戦カードと不戦勝', () => {
  test('対戦カードは段階の印を描き、「サイトを開く」をrel="noopener"の別タブで開く', async () => {
    await renderRound(
      boardRoundOf({
        round: 7,
        roundName: '準決勝',
        matches: [
          boardMatchOf(11, { round: 7, stage: 'SEMIFINAL' }),
          boardMatchOf(12, { round: 7, stage: 'SEMIFINAL' }, 'YEAR'),
        ],
      }),
    );

    const cards = region().getByRole('article');
    await expect.element(cards.first()).toBeVisible();
    const [weekCard, yearCard] = cards.elements();
    expect(weekCard?.textContent).toContain('Week 準決勝');
    expect(yearCard?.textContent).toContain('Year 準決勝');
    const siteLink = cards
      .first()
      .getByRole('link', { name: /^Left 11の\s*サイトを開く/u });
    await expect.element(siteLink).toHaveAttribute('rel', 'noopener');
    await expect.element(siteLink).toHaveAttribute('target', '_blank');
  });

  test('画面幅1280px以上は対戦カードを2列に並べる', async () => {
    await renderRound();
    await expect.element(region().getByRole('article').first()).toBeVisible();

    const [first, second] = region().getByRole('article').elements();
    expect(first?.getBoundingClientRect().top).toBe(
      second?.getBoundingClientRect().top,
    );
  });

  test('不戦勝と早期勝利は対戦カードの後の「不戦勝」の一覧に並べ、早期勝利には確定時点のUpvote数を添える', async () => {
    await renderRound(
      boardRoundOf({
        matches: [boardMatchOf(1)],
        byes: [
          boardByeOf(1),
          boardByeOf(2, { endedEarly: true, upvoteCount: 15 }),
        ],
      }),
    );

    await expect
      .element(region().getByRole('heading', { name: '不戦勝', level: 3 }))
      .toBeVisible();
    const byes = region()
      .getByRole('list', { name: '不戦勝' })
      .getByRole('article');
    expect(
      byes.elements().map((bye) => bye.getAttribute('aria-label')),
    ).toStrictEqual(['Bye 1(不戦勝)', 'Bye 2(不戦勝)']);
    expect(byes.elements()[1]?.textContent).toContain('15票');
    const articles = region().getByRole('article').elements();
    expect(articles).toHaveLength(3);
    expect(articles.at(-1)?.getAttribute('aria-label')).toBe('Bye 2(不戦勝)');
  });

  test('対戦カードのUpvoteの成功は、サーバーが返したマッチを呼び出し元へ渡す', async () => {
    const match = boardMatchOf(1);
    const [left, right] = match.entries;
    const updated: MatchFragment = {
      ...match,
      viewerUpvotedEntryId: left?.id ?? null,
      entries: [
        entryOf('left', { ...left, upvoteCount: 13 }),
        right ?? entryOf('right'),
      ],
    };
    executeGraphQL.mockImplementation((document) =>
      document === ClientUpvoteDocument
        ? Promise.resolve({ ok: true, data: { upvote: updated } })
        : Promise.reject(new Error('想定外の取得')),
    );
    const { onUpdated } = await renderRound(boardRoundOf({ matches: [match] }));
    await userEvent.click(
      page.getByRole('button', { name: '判定を成功させる' }),
    );

    await userEvent.click(
      region().getByRole('button', { name: /^Left 1にUpvote/u }),
    );

    await vi.waitFor(() => {
      expect(onUpdated).toHaveBeenCalledWith(updated);
    });
  });
});

describe('TournamentBoardRoundの状態の領域', () => {
  test('状態の文を渡さなければ状態の領域を置かない', async () => {
    await renderRound();

    await expect.element(region()).toBeVisible();
    expect(region().getByRole('status').elements()).toHaveLength(0);
  });

  test('状態の文がnullの間は空の状態の領域を置き、文を渡すと見出しの下に示す', async () => {
    await renderRound(boardRoundOf(), { statusMessage: null });
    await expect.element(region().getByRole('status')).toHaveTextContent('');
  });

  test('状態の文を見出しの下の状態の領域に示す', async () => {
    await renderRound(boardRoundOf(), {
      statusMessage: '結果を確認しています',
    });

    await expect
      .element(region().getByRole('status'))
      .toHaveTextContent('結果を確認しています');
  });
});

describe('TournamentBoardRoundのアクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '配色が%sのとき、対戦カードと不戦勝を並べた行のアクセシビリティの検査の違反が0件',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderRound(
        boardRoundOf({ byes: [boardByeOf(1, { endedEarly: true })] }),
        { statusMessage: null },
      );
      await expect.element(region().getByRole('article').first()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});

describe('TournamentBoardRoundのYearの文言の例', () => {
  test('Yearの文言を渡すと、見出しに「Product of the Yearトーナメント」とラウンド名を置き、対象年・決勝日・ブラケットへの通常のリンクを並べる', async () => {
    await renderRound(
      boardRoundOf({
        roundName: '準決勝',
        periodLabel: YEAR_TOURNAMENT_LABEL,
        finalDate: '2027-05-30',
        bracketPath: YEAR_BRACKET_PATH,
        matches: [
          boardMatchOf(11, { round: 2, stage: 'SEMIFINAL' }, 'YEAR'),
          boardMatchOf(12, { round: 2, stage: 'SEMIFINAL' }, 'YEAR'),
        ],
      }),
      { title: YEAR_BOARD_COPY.sectionTitle },
    );

    const yearRegion = region(YEAR_BOARD_COPY.sectionTitle);
    await expect
      .element(yearRegion.getByRole('heading', { level: 2 }))
      .toHaveTextContent('Product of the Yearトーナメント準決勝');
    await expect
      .element(yearRegion.getByText('2027年', { exact: true }))
      .toBeVisible();
    const finalDate = timeOf('2027-05-30');
    expect(finalDate?.textContent).toMatch(/5月30日$/u);
    expect(finalDate?.parentElement?.textContent).toMatch(/^決勝日/u);
    const link = yearRegion.getByRole('link', { name: 'ブラケットを見る' });
    await expect
      .element(link)
      .toHaveAttribute('href', '/tournaments/year/2027');
    expect(link.element().getAttribute('target')).toBeNull();
    expect(
      yearRegion.getByRole('article').elements()[0]?.textContent,
    ).toContain('Year 準決勝');
  });
});
