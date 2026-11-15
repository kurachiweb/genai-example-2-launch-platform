import type {
  ClientQualifierBoardQuery,
  MatchFragment,
} from '../../graphql/generated/graphql.ts';
import { byeOf, entryOf, matchOf, productOf } from '../match/match-fixtures.ts';

export type QualifierBoardView = ClientQualifierBoardQuery['qualifierBoard'];

// 業務日付2026-11-10の23:40と翌日の0:00(閲覧者のタイムゾーンAsia/Tokyoで表示する時刻)
export const FULL_TIME_AT = '2026-11-10T14:40:00.000Z';
export const NEXT_KICKOFF_AT = '2026-11-10T15:00:00.000Z';

const serial = (value: number): string => String(value).padStart(4, '0');

// n番目の予選の対戦カード。名称は「Left <n>」と「Right <n>」
export const qualifierMatchOf = (
  n: number,
  overrides: Partial<MatchFragment> = {},
): MatchFragment =>
  matchOf({
    id: `01JD0MATCH0000000000Q0${serial(n)}`,
    entries: [
      entryOf('left', {
        id: `01JD0ENTRY0000000000L0${serial(n)}`,
        product: productOf('left', { name: `Left ${String(n)}` }),
      }),
      entryOf('right', {
        id: `01JD0ENTRY0000000000R0${serial(n)}`,
        product: productOf('right', { name: `Right ${String(n)}` }),
      }),
    ],
    ...overrides,
  });

export const qualifierMatchesOf = (count: number): MatchFragment[] =>
  Array.from({ length: count }, (_, index) => qualifierMatchOf(index + 1));

export const qualifierBoardOf = (
  overrides: Partial<QualifierBoardView> = {},
): QualifierBoardView => ({
  date: '2026-11-10',
  serverTime: '2026-11-10T03:00:00.000Z',
  phase: 'LIVE',
  fullTimeAt: FULL_TIME_AT,
  nextKickoffAt: NEXT_KICKOFF_AT,
  awaitingKickoff: false,
  heldCount: 3,
  matches: qualifierMatchesOf(2),
  byes: [byeOf({ match: { endedEarly: true } })],
  ...overrides,
});
