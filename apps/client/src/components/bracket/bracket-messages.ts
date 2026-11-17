import { TALLYING_LABEL } from '../match/match-labels.ts';
import type {
  BracketMatchStatus,
  BracketSlotOutcome,
} from './bracket-view-model.ts';

export const BRACKET_ROUND_TABS_LABEL = 'ラウンド';

export const BRACKET_SCROLL_REGION_LABEL = 'ブラケット(横にスクロールできます)';

export const BRACKET_VERSUS_LABEL = 'vs';

export const BRACKET_UPVOTE_COUNT_LABEL = 'Upvote数';

export const BRACKET_NO_OPPONENT_LABEL = '対戦相手なし';

export const BRACKET_NO_AWARD_LABEL = '受賞プロダクトはありません';

export const bracketMatchHeading = (
  roundName: string,
  position: number,
): string => `${roundName}第${String(position)}試合`;

export const bracketSeedLabel = (seed: number): string =>
  `シード${String(seed)}`;

// 予定を作る前の1回戦の非シードの枠は、表記の代わりに抽選番号を示す
export const bracketDrawNumberLabel = (participantNo: number): string =>
  `抽選番号${String(participantNo)}`;

export const BRACKET_MATCH_STATUS_LABELS: Readonly<
  Record<BracketMatchStatus, string>
> = Object.freeze({
  scheduled: '予定',
  live: 'マッチ中',
  tallying: TALLYING_LABEL,
  finished: '確定',
});

export const BRACKET_SLOT_OUTCOME_LABELS: Readonly<
  Record<BracketSlotOutcome, string>
> = Object.freeze({
  won: '勝利',
  lost: '敗北',
  bye: '不戦勝',
  'both-lost': '両者敗北',
});
