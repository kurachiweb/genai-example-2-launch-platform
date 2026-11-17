import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { resetFakeTurnstile } from '../../../lib/test/fake-turnstile.tsx';
import { emulateReducedMotion } from '../../../lib/test/reduced-motion.ts';
import type { MatchFragment } from '../../graphql/generated/graphql.ts';
import { entryOf } from '../match/match-fixtures.ts';
import {
  type MotionHost,
  renderInMatchFrame,
} from '../match/match-testing.tsx';
import { UpvoteBotProtection } from '../match/upvote-bot-protection.tsx';
import {
  type BoardRoundFixture,
  boardFinalRoundOf,
  boardMatchOf,
  FINAL_COPY,
} from './tournament-board-fixtures.ts';
import { splitBoardRound } from './tournament-board-model.ts';
import { finalOutcomeOf } from './tournament-final-model.ts';
import { TournamentFinalRound } from './tournament-final-round.tsx';

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../../../lib/test/fake-turnstile.tsx'),
);

const DESKTOP = { width: 1280, height: 900 } as const;

const AWARDED_MESSAGE = 'フルタイム！Right 21がProduct of the Testを受賞🎉';

const NO_AWARD_MESSAGE =
  'フルタイム。0対0で両者敗北。今回の受賞プロダクトはありません';

const finalMatchOf = (overrides: Partial<MatchFragment> = {}): MatchFragment =>
  boardMatchOf(21, { round: 8, stage: 'FINAL', ...overrides });

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

const renderFinal = async (
  round: BoardRoundFixture = boardFinalRoundOf(),
  {
    statusMessage = null,
    host = 'on',
  }: {
    readonly statusMessage?: string | null;
    readonly host?: MotionHost;
  } = {},
) => {
  const row = splitBoardRound(round);
  await renderInMatchFrame(
    <UpvoteBotProtection>
      <main className="bg-background text-foreground">
        <TournamentFinalRound
          row={row}
          periodLabel={round.periodLabel}
          bracketPath={round.bracketPath}
          copy={FINAL_COPY}
          outcome={finalOutcomeOf(row)}
          statusMessage={statusMessage}
          onUpdated={vi.fn()}
        />
      </main>
    </UpvoteBotProtection>,
    { host, width: DESKTOP.width },
  );
};

const finalRegion = () =>
  page.getByRole('region', {
    name: /^Product of the Test\s?トーナメント決勝$/u,
  });
const finalStatus = () => finalRegion().getByRole('status');

const all = (selector: string): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>(selector));
const spotlights = () => all('[data-tournament-final-spotlight]');
const confettiPieces = () => all('[data-tournament-final-confetti]');
const animationNamesOf = (elements: readonly HTMLElement[]): Set<string> =>
  new Set(elements.map((element) => getComputedStyle(element).animationName));

beforeEach(() => {
  resetFakeTurnstile();
});

afterEach(async () => {
  await emulateReducedMotion('no-preference');
  applyColorScheme('light');
  await page.viewport(DESKTOP.width, DESKTOP.height);
});

describe('TournamentFinalRoundの見出しと決勝の対戦カード', () => {
  test('種類の文言の印・題名・副題の見出しと、期間の表記に並べたブラケットへの通常のリンクを置く', async () => {
    await renderFinal();

    await expect
      .element(finalRegion().getByRole('heading', { level: 2 }))
      .toHaveTextContent('Product of the Testトーナメント決勝');
    await expect
      .element(finalRegion().getByText('Test Final', { exact: true }))
      .toBeVisible();
    const link = finalRegion().getByRole('link', { name: 'ブラケットを見る' });
    await expect
      .element(link)
      .toHaveAttribute('href', '/tournaments/test/final');
    expect(link.element().parentElement?.textContent).toContain(
      '2026年第45週(11/2〜11/8)',
    );
  });

  test('決勝の対戦カードを区画の全幅で描く', async () => {
    await renderFinal();

    const card = finalRegion().getByRole('article');
    await expect.element(card).toBeVisible();
    expect(card.element().getBoundingClientRect().width).toBe(
      finalRegion().element().getBoundingClientRect().width,
    );
    expect(card.element().textContent).toContain('Week 決勝');
  });
});

describe('TournamentFinalRoundの結果', () => {
  test('確定の前は状態の領域を空のまま置き、紙吹雪を描かない', async () => {
    await renderFinal();

    await expect.element(finalStatus()).toHaveTextContent('');
    expect(confettiPieces()).toHaveLength(0);
  });

  test('確定の前は、渡した状態の文を状態の領域に示す', async () => {
    await renderFinal(boardFinalRoundOf(), { statusMessage: '確認しています' });

    await expect.element(finalStatus()).toHaveTextContent('確認しています');
  });

  test('受賞の文は種類の文言で示し、紙吹雪を描く', async () => {
    await renderFinal(
      boardFinalRoundOf({ matches: [decidedFinalOf('VOTES')] }),
      {
        statusMessage: '確認しています',
      },
    );

    await expect.element(finalStatus()).toHaveTextContent(AWARDED_MESSAGE);
    expect(confettiPieces().length).toBeGreaterThan(0);
  });

  test('受賞なしの文は種類の文言で示し、紙吹雪を描かない', async () => {
    await renderFinal(
      boardFinalRoundOf({ matches: [decidedFinalOf('NO_VOTES')] }),
    );

    await expect.element(finalStatus()).toHaveTextContent(NO_AWARD_MESSAGE);
    expect(confettiPieces()).toHaveLength(0);
  });
});

describe('TournamentFinalRoundの演出', () => {
  test('自動更新がオンで視差効果を減らす設定でない間は、照明と紙吹雪を動かす', async () => {
    await renderFinal(
      boardFinalRoundOf({ matches: [decidedFinalOf('VOTES')] }),
    );
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

  test('視差効果を減らす設定では、照明を止めて紙吹雪を隠す', async () => {
    await emulateReducedMotion('reduce');
    await renderFinal(
      boardFinalRoundOf({ matches: [decidedFinalOf('VOTES')] }),
    );
    await expect.element(finalStatus()).toHaveTextContent(AWARDED_MESSAGE);

    expect(animationNamesOf(spotlights())).toStrictEqual(new Set(['none']));
    expect(
      confettiPieces().every(
        (piece) => getComputedStyle(piece).display === 'none',
      ),
    ).toBe(true);
  });

  test('祖先の自動更新がオフの間は、照明を止めて紙吹雪を隠す', async () => {
    await renderFinal(
      boardFinalRoundOf({ matches: [decidedFinalOf('VOTES')] }),
      { host: 'off' },
    );
    await expect.element(finalStatus()).toHaveTextContent(AWARDED_MESSAGE);

    expect(animationNamesOf(spotlights())).toStrictEqual(new Set(['none']));
    expect(
      confettiPieces().every(
        (piece) => getComputedStyle(piece).display === 'none',
      ),
    ).toBe(true);
  });
});

describe('TournamentFinalRoundのアクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '配色が%sのとき、受賞の後の決勝のアクセシビリティの検査の違反が0件',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderFinal(
        boardFinalRoundOf({ matches: [decidedFinalOf('VOTES')] }),
      );
      await expect.element(finalStatus()).toHaveTextContent(AWARDED_MESSAGE);

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
