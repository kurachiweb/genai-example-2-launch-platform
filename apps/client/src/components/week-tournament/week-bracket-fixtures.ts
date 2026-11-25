import {
  bracketMatchOf,
  bracketNodeOf,
  bracketProductOf,
  bracketRoundOf,
  EMPTY_BRACKET_SLOT,
  IN_PROGRESS_FIRST_ROUND,
  IN_PROGRESS_ROUNDS,
  playedSlotOf,
} from '../bracket/bracket-fixtures.ts';
import type { BracketViewRound } from '../bracket/bracket-view-props.ts';
import type { WeekBracketView } from './week-bracket-model.ts';

export const WEEK_BRACKET_WEEK = '2026-W45';

export const WEEK_BRACKET_LABEL = '2026年第45週(11/2〜11/8)';

// 参加6・シード2のブラケットの終了後。準決勝は抽選番号1の勝利とシード2の不戦勝、決勝は抽選番号1の勝利
export const FINISHED_ROUNDS: readonly BracketViewRound[] = Object.freeze([
  IN_PROGRESS_FIRST_ROUND,
  bracketRoundOf(2, '準決勝', '2026-11-11', [
    bracketNodeOf(
      1,
      bracketMatchOf(3, {
        round: 2,
        stage: 'SEMIFINAL',
        date: '2026-11-11',
        phase: 'FINISHED',
        decision: 'VOTES',
      }),
      [
        playedSlotOf(1, { seed: 1, upvoteCount: 15, result: 'WON' }),
        playedSlotOf(3, { upvoteCount: 7, result: 'LOST' }),
      ],
    ),
    bracketNodeOf(
      2,
      bracketMatchOf(4, {
        round: 2,
        stage: 'SEMIFINAL',
        date: '2026-11-11',
        phase: 'FINISHED',
        decision: 'BYE',
      }),
      [playedSlotOf(2, { seed: 2, result: 'BYE' }), EMPTY_BRACKET_SLOT],
    ),
  ]),
  bracketRoundOf(3, '決勝', '2026-11-12', [
    bracketNodeOf(
      1,
      bracketMatchOf(5, {
        round: 3,
        stage: 'FINAL',
        date: '2026-11-12',
        phase: 'FINISHED',
        decision: 'VOTES',
      }),
      [
        playedSlotOf(1, { seed: 1, upvoteCount: 21, result: 'WON' }),
        playedSlotOf(2, { seed: 2, upvoteCount: 18, result: 'LOST' }),
      ],
    ),
  ]),
]);

export interface WeekBracketOverrides extends Partial<
  Omit<WeekBracketView, 'tournament'>
> {
  readonly tournament?: Partial<WeekBracketView['tournament']>;
}

// 2026年第45週のWeekトーナメント。既定は参加6・シード2の開催中(準決勝のマッチ中)
export const weekBracketOf = ({
  tournament,
  ...overrides
}: WeekBracketOverrides = {}): WeekBracketView => ({
  tournament: {
    week: WEEK_BRACKET_WEEK,
    label: WEEK_BRACKET_LABEL,
    firstRoundDate: '2026-11-10',
    finalDate: '2026-11-12',
    status: 'IN_PROGRESS',
    awarded: null,
    ...tournament,
  },
  participantCount: 6,
  seedCount: 2,
  rounds: [...IN_PROGRESS_ROUNDS],
  champion: null,
  ...overrides,
});

// 決勝で抽選番号1(Bracket Product 1)が受賞して終えた週
export const AWARDED_WEEK_BRACKET: WeekBracketView = weekBracketOf({
  tournament: { status: 'FINISHED', awarded: true },
  rounds: [...FINISHED_ROUNDS],
  champion: bracketProductOf(1),
});
