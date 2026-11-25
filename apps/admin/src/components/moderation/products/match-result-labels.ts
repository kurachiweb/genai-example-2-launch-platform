import {
  roundLabel,
  TOURNAMENT_STAGES,
  type TournamentStage,
} from '../../../../common-lib/tournament/round-name.ts';
import type { AdminModerationMatchView } from '../../../graphql/admin-moderation-products.ts';
import {
  HIDDEN_OPPONENT_LABEL,
  MATCH_KIND_LABELS,
  MATCH_RESULT_LABELS,
  NO_VALUE_LABEL,
} from '../shared/moderation-messages.ts';

const QUALIFIER_KIND = 'qualifier';

// 対戦相手のいないマッチの勝ち上がり
const BYE_RESULT = 'bye';

const countFormat = new Intl.NumberFormat('ja-JP');

// 種別・ステージ・勝敗はAPIサーバーが上流の値の文字列のまま返すため、表示名の無い値は値のまま示す
const KIND_LABELS: Readonly<Record<string, string>> = MATCH_KIND_LABELS;

const RESULT_LABELS: Readonly<Record<string, string>> = Object.freeze({
  won: MATCH_RESULT_LABELS.won,
  lost: MATCH_RESULT_LABELS.lost,
  bye: MATCH_RESULT_LABELS.walkover,
  // 相手の棄権や退会による勝利
  walkover: MATCH_RESULT_LABELS.walkover,
});

const isTournamentStage = (value: string | null): value is TournamentStage =>
  value !== null && (TOURNAMENT_STAGES as readonly string[]).includes(value);

export const matchKindLabel = (kind: string): string =>
  KIND_LABELS[kind] ?? kind;

export const matchRoundLabel = ({
  kind,
  round,
  stage,
}: Pick<AdminModerationMatchView, 'kind' | 'round' | 'stage'>): string =>
  kind === QUALIFIER_KIND
    ? NO_VALUE_LABEL
    : (roundLabel({
        round,
        stage: isTournamentStage(stage) ? stage : null,
      }) ?? NO_VALUE_LABEL);

export const matchOpponentLabel = ({
  result,
  opponentName,
}: Pick<AdminModerationMatchView, 'result' | 'opponentName'>): string => {
  if (result === BYE_RESULT) {
    return NO_VALUE_LABEL;
  }
  return opponentName ?? HIDDEN_OPPONENT_LABEL;
};

export const matchUpvoteLabel = ({
  result,
  upvoteCount,
}: Pick<AdminModerationMatchView, 'result' | 'upvoteCount'>): string =>
  result === BYE_RESULT ? NO_VALUE_LABEL : countFormat.format(upvoteCount);

// 開始の日時を迎えていないマッチ。開始の後は確定するまで(集計中を含めて)マッチ中と示す
const SCHEDULED_PHASE = 'scheduled';

// Upvoteが無いか両方の側が棄権した決着は、両方の側が敗北になる
const BOTH_LOST_DECISIONS: ReadonlySet<string> = new Set([
  'no_votes',
  'both_forfeited',
]);

const LOST_RESULT = 'lost';

export const matchResultLabel = ({
  result,
  phase,
  decision,
}: Pick<AdminModerationMatchView, 'result' | 'phase' | 'decision'>): string => {
  if (result === null) {
    return phase === SCHEDULED_PHASE
      ? MATCH_RESULT_LABELS.scheduled
      : MATCH_RESULT_LABELS.inProgress;
  }
  if (
    result === LOST_RESULT &&
    decision !== null &&
    BOTH_LOST_DECISIONS.has(decision)
  ) {
    return MATCH_RESULT_LABELS.bothLost;
  }
  return RESULT_LABELS[result] ?? result;
};
