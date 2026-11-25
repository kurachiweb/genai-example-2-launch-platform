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
import type { TournamentBracketPageView } from './tournament-bracket-model.ts';
import type { TournamentBracketCopy } from './tournament-copy.ts';

export const BRACKET_PERIOD_LABEL = '2026年第45週(11/2〜11/8)';

export const BRACKET_TITLE = 'Product of the Testトーナメント';

export const BRACKET_AWARD_NAME = 'Product of the Test';

export const BRACKET_ERROR_MESSAGE =
  'テストのブラケットを読み込めませんでした。時間をおいて再度お試しください。';

export const BRACKET_COPY: TournamentBracketCopy = Object.freeze({
  title: BRACKET_TITLE,
  awardName: BRACKET_AWARD_NAME,
  counts: (participantCount: number, seedCount: number) =>
    `テストの参加${String(participantCount)}・シード${String(seedCount)}`,
  error: BRACKET_ERROR_MESSAGE,
});

// 参加6・シード2のブラケットの終了後。準決勝は抽選番号1の勝利とシード2の不戦勝、決勝は抽選番号1の勝利
export const FINISHED_BRACKET_ROUNDS: readonly BracketViewRound[] =
  Object.freeze([
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

export interface TournamentBracketOverrides extends Partial<
  Omit<TournamentBracketPageView, 'tournament'>
> {
  readonly tournament?: Partial<TournamentBracketPageView['tournament']>;
}

// 種類の照会のブラケットの値。既定は参加6・シード2の開催中(準決勝のマッチ中)
export const tournamentBracketOf = ({
  tournament,
  ...overrides
}: TournamentBracketOverrides = {}): TournamentBracketPageView => ({
  tournament: {
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

// 決勝で抽選番号1(Bracket Product 1)が受賞して終えたトーナメント
export const AWARDED_TOURNAMENT_BRACKET: TournamentBracketPageView =
  tournamentBracketOf({
    tournament: { status: 'FINISHED', awarded: true },
    rounds: [...FINISHED_BRACKET_ROUNDS],
    champion: bracketProductOf(1),
  });
