import type {
  ClientWeekTournamentBoardQuery,
  MatchByeFragment,
  MatchFragment,
  WeekBoardRoundFieldsFragment,
} from '../../graphql/generated/graphql.ts';
import { byeOf, entryOf, matchOf, productOf } from '../match/match-fixtures.ts';

export type WeekBoardView =
  ClientWeekTournamentBoardQuery['weekTournamentBoard'];

export const WEEK_BOARD_DATE = '2026-11-10';

const serial = (value: number): string => String(value).padStart(4, '0');

// n番目のWeekトーナメントの対戦カード。名称は「Week Left <n>」と「Week Right <n>」で、既定は1回戦のマッチ中
export const weekMatchOf = (
  n: number,
  overrides: Partial<MatchFragment> = {},
): MatchFragment =>
  matchOf({
    id: `01JD0MATCH0000000000W0${serial(n)}`,
    kind: 'WEEK',
    round: 1,
    stage: null,
    entries: [
      entryOf('left', {
        id: `01JD0ENTRY000000000WA0${serial(n)}`,
        product: productOf('left', {
          handle: `week-left-${String(n)}`,
          name: `Week Left ${String(n)}`,
          listed: true,
        }),
      }),
      entryOf('right', {
        id: `01JD0ENTRY000000000WR0${serial(n)}`,
        product: productOf('right', {
          handle: `week-right-${String(n)}`,
          name: `Week Right ${String(n)}`,
          listed: true,
        }),
      }),
    ],
    ...overrides,
  });

// n番目のWeekトーナメントの不戦勝。名称は「Week Bye <n>」。endedEarlyが真なら早期勝利にする
export const weekByeOf = (
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
      id: `01JD0MATCH0000000000B0${serial(n)}`,
      kind: 'WEEK',
      round,
      stage: null,
      endedEarly,
    },
    entry: {
      id: `01JD0ENTRY000000000WB0${serial(n)}`,
      upvoteCount,
      result: endedEarly ? 'WALKOVER' : 'BYE',
      product: productOf('left', {
        handle: `week-bye-${String(n)}`,
        name: `Week Bye ${String(n)}`,
        listed: true,
      }),
    },
  });

// 2026年第46週(11/9〜11/15)のトーナメントの1回戦の行
export const weekBoardRoundOf = (
  overrides: Partial<WeekBoardRoundFieldsFragment> = {},
): WeekBoardRoundFieldsFragment => ({
  tournament: {
    week: '2026-W46',
    label: '2026年第46週(11/9〜11/15)',
    firstRoundDate: WEEK_BOARD_DATE,
    finalDate: '2026-11-17',
    status: 'IN_PROGRESS',
    awarded: null,
  },
  round: 1,
  roundName: '1回戦',
  final: false,
  matches: [weekMatchOf(1), weekMatchOf(2)],
  byes: [],
  bracketPath: '/tournaments/week/2026-W46',
  ...overrides,
});

export const weekBoardOf = (
  overrides: Partial<WeekBoardView> = {},
): WeekBoardView => ({
  date: WEEK_BOARD_DATE,
  serverTime: '2026-11-10T03:00:00.000Z',
  rounds: [weekBoardRoundOf()],
  ...overrides,
});

export const weekBoardResult = (board: WeekBoardView = weekBoardOf()) => ({
  ok: true as const,
  data: { weekTournamentBoard: board },
});

// マッチが無い日の盤面
export const EMPTY_WEEK_BOARD = Object.freeze(weekBoardOf({ rounds: [] }));
