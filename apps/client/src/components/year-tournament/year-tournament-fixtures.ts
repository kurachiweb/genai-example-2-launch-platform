import type {
  BracketMatchProductFieldsFragment,
  ClientYearTournamentBoardQuery,
  MatchByeFragment,
  MatchFragment,
  YearBoardRoundFieldsFragment,
} from '../../graphql/generated/graphql.ts';
import {
  bracketMatchOf,
  bracketNodeOf,
  bracketProductOf,
  bracketRoundOf,
  EMPTY_BRACKET_SLOT,
  feedSlotOf,
  playedSlotOf,
} from '../bracket/bracket-fixtures.ts';
import type {
  BracketViewMatch,
  BracketViewRound,
} from '../bracket/bracket-view-props.ts';
import { byeOf, entryOf, matchOf, productOf } from '../match/match-fixtures.ts';
import type { YearBracketView } from './year-bracket-model.ts';

export type YearBoardView =
  ClientYearTournamentBoardQuery['yearTournamentBoard'];

export const YEAR_TOURNAMENT_YEAR = 2027;

export const YEAR_TOURNAMENT_LABEL = '2027年';

export const YEAR_BRACKET_PATH = '/tournaments/year/2027';

// 2027年のYearトーナメントの1回戦の業務日付
export const YEAR_BOARD_DATE = '2027-05-27';

// 2027年のYearトーナメントの決勝の業務日付(5月の最終日曜日)
export const YEAR_FINAL_DATE = '2027-05-30';

const serial = (value: number): string => String(value).padStart(4, '0');

// n番目のYearトーナメントの対戦カード。名称は「Year Left <n>」と「Year Right <n>」で、既定は1回戦のマッチ中
export const yearMatchOf = (
  n: number,
  overrides: Partial<MatchFragment> = {},
): MatchFragment =>
  matchOf({
    id: `01JD0MATCH0000000000Y0${serial(n)}`,
    kind: 'YEAR',
    round: 1,
    stage: null,
    entries: [
      entryOf('left', {
        id: `01JD0ENTRY000000000YA0${serial(n)}`,
        product: productOf('left', {
          handle: `year-left-${String(n)}`,
          name: `Year Left ${String(n)}`,
          listed: true,
        }),
      }),
      entryOf('right', {
        id: `01JD0ENTRY000000000YR0${serial(n)}`,
        product: productOf('right', {
          handle: `year-right-${String(n)}`,
          name: `Year Right ${String(n)}`,
          listed: true,
        }),
      }),
    ],
    ...overrides,
  });

// n番目のYearトーナメントの不戦勝。名称は「Year Bye <n>」。endedEarlyが真なら早期勝利にする
export const yearByeOf = (
  n: number,
  {
    endedEarly = false,
    upvoteCount = 0,
    round = 1,
  }: {
    readonly endedEarly?: boolean;
    readonly upvoteCount?: number;
    readonly round?: number;
  } = {},
): MatchByeFragment =>
  byeOf({
    match: {
      id: `01JD0MATCH0000000000YB${serial(n)}`,
      kind: 'YEAR',
      round,
      stage: null,
      endedEarly,
    },
    entry: {
      id: `01JD0ENTRY000000000YB0${serial(n)}`,
      upvoteCount,
      result: endedEarly ? 'WALKOVER' : 'BYE',
      product: productOf('left', {
        handle: `year-bye-${String(n)}`,
        name: `Year Bye ${String(n)}`,
        listed: true,
      }),
    },
  });

const YEAR_BOARD_TOURNAMENT: YearBoardRoundFieldsFragment['tournament'] =
  Object.freeze({
    year: YEAR_TOURNAMENT_YEAR,
    label: YEAR_TOURNAMENT_LABEL,
    firstRoundDate: YEAR_BOARD_DATE,
    finalDate: YEAR_FINAL_DATE,
    status: 'IN_PROGRESS',
    awarded: null,
  });

// 2027年のYearトーナメントの1回戦の行。行の決勝日は遅れの無い決勝の日
export const yearBoardRoundOf = (
  overrides: Partial<YearBoardRoundFieldsFragment> = {},
): YearBoardRoundFieldsFragment => ({
  tournament: { ...YEAR_BOARD_TOURNAMENT },
  round: 1,
  roundName: '1回戦',
  final: false,
  finalDate: YEAR_FINAL_DATE,
  matches: [yearMatchOf(1), yearMatchOf(2)],
  byes: [],
  bracketPath: YEAR_BRACKET_PATH,
  ...overrides,
});

// 2027年のYearトーナメントの決勝の行。既定はその日の決勝のマッチ中で、名称は「Year Left 21」と「Year Right 21」
export const yearFinalRoundOf = (
  overrides: Partial<YearBoardRoundFieldsFragment> = {},
): YearBoardRoundFieldsFragment =>
  yearBoardRoundOf({
    round: 3,
    roundName: '決勝',
    final: true,
    matches: [yearMatchOf(21, { round: 3, stage: 'FINAL' })],
    ...overrides,
  });

export const yearBoardOf = (
  overrides: Partial<YearBoardView> = {},
): YearBoardView => ({
  date: YEAR_BOARD_DATE,
  serverTime: '2027-05-27T03:00:00.000Z',
  rounds: [yearBoardRoundOf()],
  ...overrides,
});

// 2027年のYearトーナメントの決勝の日の盤面
export const yearFinalBoardOf = (
  overrides: Partial<YearBoardView> = {},
): YearBoardView =>
  yearBoardOf({
    date: YEAR_FINAL_DATE,
    serverTime: '2027-05-30T03:00:00.000Z',
    rounds: [yearFinalRoundOf()],
    ...overrides,
  });

export const yearBoardResult = (board: YearBoardView = yearBoardOf()) => ({
  ok: true as const,
  data: { yearTournamentBoard: board },
});

// マッチが無い日の盤面
export const EMPTY_YEAR_BOARD: YearBoardView = Object.freeze(
  yearBoardOf({ rounds: [] }),
);

const yearBracketMatchOf = (
  id: number,
  overrides: Partial<BracketViewMatch> = {},
): BracketViewMatch =>
  bracketMatchOf(id, { kind: 'YEAR', date: '2027-05-28', ...overrides });

// 参加6・シード2のブラケットの1回戦。第1試合は抽選番号3の勝利、第2試合は両者敗北
const YEAR_FIRST_ROUND: BracketViewRound = bracketRoundOf(
  1,
  '1回戦',
  '2027-05-28',
  [
    bracketNodeOf(
      1,
      yearBracketMatchOf(1, { phase: 'FINISHED', decision: 'VOTES' }),
      [
        playedSlotOf(3, { upvoteCount: 12, result: 'WON' }),
        playedSlotOf(4, { upvoteCount: 9, result: 'LOST' }),
      ],
    ),
    bracketNodeOf(
      2,
      yearBracketMatchOf(2, { phase: 'FINISHED', decision: 'NO_VOTES' }),
      [
        playedSlotOf(5, { result: 'LOST' }),
        playedSlotOf(6, { result: 'LOST' }),
      ],
    ),
  ],
);

const YEAR_SEMIFINAL_BYE = bracketNodeOf(
  2,
  yearBracketMatchOf(4, {
    round: 2,
    stage: 'SEMIFINAL',
    date: '2027-05-29',
    phase: 'FINISHED',
    decision: 'BYE',
  }),
  [playedSlotOf(2, { seed: 2, result: 'BYE' }), EMPTY_BRACKET_SLOT],
);

// 開催中(準決勝のマッチ中)。準決勝の第1試合はシード1と抽選番号3のマッチ中、第2試合はシード2の不戦勝、決勝は予定を作る前
export const YEAR_IN_PROGRESS_ROUNDS: readonly BracketViewRound[] =
  Object.freeze([
    YEAR_FIRST_ROUND,
    bracketRoundOf(2, '準決勝', '2027-05-29', [
      bracketNodeOf(
        1,
        yearBracketMatchOf(3, {
          round: 2,
          stage: 'SEMIFINAL',
          date: '2027-05-29',
          phase: 'LIVE',
        }),
        [
          playedSlotOf(1, { seed: 1, upvoteCount: 5 }),
          playedSlotOf(3, { upvoteCount: 7 }),
        ],
      ),
      YEAR_SEMIFINAL_BYE,
    ]),
    bracketRoundOf(3, '決勝', YEAR_FINAL_DATE, [
      bracketNodeOf(1, null, [
        feedSlotOf('準決勝第1試合の勝者'),
        feedSlotOf('準決勝第2試合の勝者', { participantNo: 2, seed: 2 }),
      ]),
    ]),
  ]);

const yearFinishedRoundsOf = (
  decision: 'VOTES' | 'NO_VOTES',
): readonly BracketViewRound[] =>
  Object.freeze([
    YEAR_FIRST_ROUND,
    bracketRoundOf(2, '準決勝', '2027-05-29', [
      bracketNodeOf(
        1,
        yearBracketMatchOf(3, {
          round: 2,
          stage: 'SEMIFINAL',
          date: '2027-05-29',
          phase: 'FINISHED',
          decision: 'VOTES',
        }),
        [
          playedSlotOf(1, { seed: 1, upvoteCount: 15, result: 'WON' }),
          playedSlotOf(3, { upvoteCount: 7, result: 'LOST' }),
        ],
      ),
      YEAR_SEMIFINAL_BYE,
    ]),
    bracketRoundOf(3, '決勝', YEAR_FINAL_DATE, [
      bracketNodeOf(
        1,
        yearBracketMatchOf(5, {
          round: 3,
          stage: 'FINAL',
          date: YEAR_FINAL_DATE,
          phase: 'FINISHED',
          decision,
        }),
        decision === 'VOTES'
          ? [
              playedSlotOf(1, { seed: 1, upvoteCount: 21, result: 'WON' }),
              playedSlotOf(2, { seed: 2, upvoteCount: 18, result: 'LOST' }),
            ]
          : [
              playedSlotOf(1, { seed: 1, result: 'LOST' }),
              playedSlotOf(2, { seed: 2, result: 'LOST' }),
            ],
      ),
    ]),
  ]);

// 決勝で抽選番号1が勝利して終えたブラケットの全ラウンド
export const YEAR_AWARDED_ROUNDS = yearFinishedRoundsOf('VOTES');

// 決勝が両者敗北で終えたブラケットの全ラウンド
export const YEAR_NO_AWARD_ROUNDS = yearFinishedRoundsOf('NO_VOTES');

export interface YearBracketOverrides extends Partial<
  Omit<YearBracketView, 'tournament'>
> {
  readonly tournament?: Partial<YearBracketView['tournament']>;
}

// 2027年のYearトーナメント。既定は参加6・シード2の開催中(準決勝のマッチ中)で、終了の前のため受賞の有無はnull
export const yearBracketOf = ({
  tournament,
  ...overrides
}: YearBracketOverrides = {}): YearBracketView => ({
  tournament: {
    year: YEAR_TOURNAMENT_YEAR,
    label: YEAR_TOURNAMENT_LABEL,
    firstRoundDate: '2027-05-28',
    finalDate: YEAR_FINAL_DATE,
    status: 'IN_PROGRESS',
    awarded: null,
    ...tournament,
  },
  participantCount: 6,
  seedCount: 2,
  rounds: [...YEAR_IN_PROGRESS_ROUNDS],
  champion: null,
  ...overrides,
});

export const YEAR_CHAMPION: BracketMatchProductFieldsFragment =
  bracketProductOf(1);

// 決勝で抽選番号1(Bracket Product 1)が受賞して終えた年
export const AWARDED_YEAR_BRACKET: YearBracketView = yearBracketOf({
  tournament: { status: 'FINISHED', awarded: true },
  rounds: [...YEAR_AWARDED_ROUNDS],
  champion: YEAR_CHAMPION,
});

// 決勝が両者敗北で、受賞なしで終えた年
export const NO_AWARD_YEAR_BRACKET: YearBracketView = yearBracketOf({
  tournament: { status: 'FINISHED', awarded: false },
  rounds: [...YEAR_NO_AWARD_ROUNDS],
  champion: null,
});

// 受賞したプロダクトが非公開・停止などで表示できなくなった年。受賞は真のまま、受賞したプロダクトはnullで届く
export const HIDDEN_CHAMPION_YEAR_BRACKET: YearBracketView = yearBracketOf({
  tournament: { status: 'FINISHED', awarded: true },
  rounds: [...YEAR_AWARDED_ROUNDS],
  champion: null,
});
