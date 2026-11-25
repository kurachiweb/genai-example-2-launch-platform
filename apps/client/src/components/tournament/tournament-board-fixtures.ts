import type {
  MatchByeFragment,
  MatchFragment,
} from '../../graphql/generated/graphql.ts';
import type { MatchKindValue } from '../match/match-labels.ts';
import { byeOf, entryOf, matchOf, productOf } from '../match/match-fixtures.ts';
import type { TournamentBoardRound } from './tournament-board-model.ts';
import type {
  TournamentBoardCopy,
  TournamentFinalCopy,
} from './tournament-copy.ts';

type TournamentKind = Exclude<MatchKindValue, 'QUALIFIER'>;

// 共用の部品のテストの行。種類の照会の行が満たす構造の型に、見出しへ渡す値を加える
export interface BoardRoundFixture extends TournamentBoardRound {
  readonly key: string;
  readonly round: number;
  readonly roundName: string;
  readonly periodLabel: string;
  readonly finalDate: string | null;
  readonly bracketPath: string;
  readonly matches: readonly MatchFragment[];
  readonly byes: readonly MatchByeFragment[];
}

export const SECTION_TITLE = 'Product of the Testトーナメント';

export const BOARD_COPY: TournamentBoardCopy = Object.freeze({
  sectionTitle: SECTION_TITLE,
});

export const FINAL_COPY: TournamentFinalCopy = Object.freeze({
  badge: 'Test Final',
  title: 'Product of the Test',
  subtitle: 'トーナメント決勝',
  awarded: (productName: string) =>
    `フルタイム！${productName}がProduct of the Testを受賞🎉`,
  noAward: 'フルタイム。0対0で両者敗北。今回の受賞プロダクトはありません',
});

const serial = (value: number): string => String(value).padStart(4, '0');

// n番目の対戦カード。名称は「Left <n>」と「Right <n>」で、既定は1回戦のマッチ中
export const boardMatchOf = (
  n: number,
  overrides: Partial<MatchFragment> = {},
  kind: TournamentKind = 'WEEK',
): MatchFragment =>
  matchOf({
    id: `01JD0MATCH0000000000T0${serial(n)}`,
    kind,
    round: 1,
    stage: null,
    entries: [
      entryOf('left', {
        id: `01JD0ENTRY000000000TL0${serial(n)}`,
        product: productOf('left', {
          handle: `left-${String(n)}`,
          name: `Left ${String(n)}`,
          listed: true,
        }),
      }),
      entryOf('right', {
        id: `01JD0ENTRY000000000TR0${serial(n)}`,
        product: productOf('right', {
          handle: `right-${String(n)}`,
          name: `Right ${String(n)}`,
          listed: true,
        }),
      }),
    ],
    ...overrides,
  });

// n番目の不戦勝。名称は「Bye <n>」。endedEarlyが真なら早期勝利にする
export const boardByeOf = (
  n: number,
  {
    endedEarly = false,
    upvoteCount = 0,
    round = 1,
    kind = 'WEEK',
  }: {
    readonly endedEarly?: boolean;
    readonly upvoteCount?: number;
    readonly round?: number;
    readonly kind?: TournamentKind;
  } = {},
): MatchByeFragment =>
  byeOf({
    match: {
      id: `01JD0MATCH0000000000TB${serial(n)}`,
      kind,
      round,
      stage: null,
      endedEarly,
    },
    entry: {
      id: `01JD0ENTRY000000000TB0${serial(n)}`,
      upvoteCount,
      result: endedEarly ? 'WALKOVER' : 'BYE',
      product: productOf('left', {
        handle: `bye-${String(n)}`,
        name: `Bye ${String(n)}`,
        listed: true,
      }),
    },
  });

// 1回戦の行
export const boardRoundOf = (
  overrides: Partial<BoardRoundFixture> = {},
): BoardRoundFixture => ({
  key: 'current',
  round: 1,
  roundName: '1回戦',
  periodLabel: '2026年第46週(11/9〜11/15)',
  finalDate: '2026-11-17',
  bracketPath: '/tournaments/test/current',
  final: false,
  matches: [boardMatchOf(1), boardMatchOf(2)],
  byes: [],
  ...overrides,
});

// 決勝の行。既定は決勝のマッチ中で、名称は「Left 21」と「Right 21」
export const boardFinalRoundOf = (
  overrides: Partial<BoardRoundFixture> = {},
): BoardRoundFixture =>
  boardRoundOf({
    key: 'final',
    round: 8,
    roundName: '決勝',
    periodLabel: '2026年第45週(11/2〜11/8)',
    finalDate: '2026-11-10',
    bracketPath: '/tournaments/test/final',
    final: true,
    matches: [boardMatchOf(21, { round: 8, stage: 'FINAL' })],
    ...overrides,
  });
