export type MatchKindValue = 'QUALIFIER' | 'WEEK' | 'YEAR';

export type MatchStageValue = 'QUARTERFINAL' | 'SEMIFINAL' | 'FINAL';

export type MatchStageLabelInput = {
  readonly kind: MatchKindValue;
  readonly round: number | null;
  readonly stage: MatchStageValue | null;
};

export type MatchResultLabelInput =
  | {
      readonly decision: 'VOTES' | 'LAST_UPVOTE';
      readonly winnerName: string;
      readonly winnerVotes: number;
      readonly loserVotes: number;
    }
  | { readonly decision: 'NO_VOTES' };

export type VoteBarLabelInput = {
  readonly leftName: string;
  readonly leftVotes: number;
  readonly rightName: string;
  readonly rightVotes: number;
};

export const TALLYING_LABEL = '結果を集計しています';

export const HIDDEN_PRODUCT_NAME = '非公開のプロダクト';

const QUALIFIER_LABEL = '予選';

const TOURNAMENT_NAMES: Readonly<
  Record<Exclude<MatchKindValue, 'QUALIFIER'>, string>
> = {
  WEEK: 'Week',
  YEAR: 'Year',
};

const STAGE_NAMES: Readonly<Record<MatchStageValue, string>> = {
  QUARTERFINAL: '準々決勝',
  SEMIFINAL: '準決勝',
  FINAL: '決勝',
};

const LAST_UPVOTE_NOTE = '(最終Upvote時刻が早いため)';

const roundNameOf = (
  round: number | null,
  stage: MatchStageValue | null,
): string | null => {
  if (stage !== null) {
    return STAGE_NAMES[stage];
  }
  return round === null ? null : `${String(round)}回戦`;
};

// 種別の印は表記規則の例外として、種別名とラウンド名を半角スペースで区切る
export function matchStageLabel({
  kind,
  round,
  stage,
}: MatchStageLabelInput): string {
  if (kind === 'QUALIFIER') {
    return QUALIFIER_LABEL;
  }
  const tournament = TOURNAMENT_NAMES[kind];
  const roundName = roundNameOf(round, stage);
  return roundName === null ? tournament : `${tournament} ${roundName}`;
}

export function matchResultLabel(result: MatchResultLabelInput): string {
  if (result.decision === 'NO_VOTES') {
    return 'フルタイム。0対0で両者敗北';
  }
  const summary = `フルタイム！${String(result.winnerVotes)}対${String(result.loserVotes)}で${result.winnerName}の勝利`;
  return result.decision === 'LAST_UPVOTE'
    ? `${summary}${LAST_UPVOTE_NOTE}`
    : summary;
}

export function voteBarLabel({
  leftName,
  leftVotes,
  rightName,
  rightVotes,
}: VoteBarLabelInput): string {
  return `${leftName}${String(leftVotes)}票、${rightName}${String(rightVotes)}票`;
}
