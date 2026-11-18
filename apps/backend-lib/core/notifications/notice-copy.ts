import { NOTIFICATION_TOPIC_COPY } from '../../../common-lib/notifications/notification-topics.ts';
import { roundLabel } from '../../../common-lib/tournament/round-name.ts';
import {
  formatWeekPeriodLabel,
  parseIsoWeek,
} from '../../../common-lib/tournament/week-period.ts';
import { parseTournamentYear } from '../../../common-lib/tournament/year-period.ts';
import type { SuppressionReason } from '../email/suppression-policy.ts';
import type {
  EntryResult,
  MatchDecision,
  MatchKind,
  MatchStage,
} from '../match/match-model.ts';
import type { AwardKind } from './notification-event-contract.ts';

export type ResultOutcome = 'won' | 'lost' | 'no_votes' | 'bye';

export interface RoundNameInput {
  readonly round: number | null;
  readonly stage: MatchStage | null;
}

export interface MatchLabelInput extends RoundNameInput {
  readonly kind: MatchKind;
}

export interface MatchResultSubjectInput {
  readonly own: string;
  // nullは「非公開のプロダクト」
  readonly opponent: string | null;
  readonly outcome: ResultOutcome;
  readonly ownVotes: number;
  readonly opponentVotes: number;
  readonly nextRoundName: string | null;
}

export type NoticeSuppressionReason = 'bounce' | 'complaint' | 'rejected';

export const UNAVAILABLE_PRODUCT_NAME = '非公開のプロダクト';

export const COMBINED_UNSUBSCRIBE_LABELS: Readonly<
  Record<'match_result' | 'match_preview', string>
> = Object.freeze({
  match_result: `${NOTIFICATION_TOPIC_COPY.match_result.label}の通知を配信停止`,
  match_preview: `${NOTIFICATION_TOPIC_COPY.match_preview.label}の通知を配信停止`,
});

const QUALIFIER_LABEL = '予選';

const TOURNAMENT_NAMES: Readonly<
  Record<Exclude<MatchKind, 'qualifier'>, string>
> = Object.freeze({ week: 'Week', year: 'Year' });

const AWARD_NAMES: Readonly<Record<AwardKind, string>> = Object.freeze({
  product_of_the_week: 'Product of the Week',
  product_of_the_year: 'Product of the Year',
});

const SUPPRESSION_REASON_NAMES: Readonly<
  Record<SuppressionReason, NoticeSuppressionReason>
> = Object.freeze({
  hard_bounce: 'bounce',
  complaint: 'complaint',
  rejected: 'rejected',
});

const RESULT_SUBJECT_PREFIX = 'フルタイム: ';
const KICKOFF_CHEER = 'がキックオフします⚽️応援しましょう！';
const WEEK_PERIOD_PATTERN = /^\d{4}-W\d{2}$/u;

const countFormat = new Intl.NumberFormat('ja-JP');

export function formatCount(value: number): string {
  return countFormat.format(value);
}

export function resultOutcomeOf(
  result: EntryResult,
  decision: MatchDecision,
): ResultOutcome | null {
  if (result === 'won') {
    return 'won';
  }
  if (result === 'bye' || result === 'walkover') {
    return 'bye';
  }
  if (decision === 'both_forfeited') {
    return null;
  }
  return decision === 'no_votes' ? 'no_votes' : 'lost';
}

export function roundName({ round, stage }: RoundNameInput): string {
  const label = roundLabel({ round, stage });
  if (label === null) {
    throw new RangeError(
      `ラウンドは1以上の整数か段で指定してください: ${String(round)}`,
    );
  }
  return label;
}

// 種別の印は表記規則の例外として、種別名とラウンド名を半角スペースで区切る
export function matchLabel({ kind, round, stage }: MatchLabelInput): string {
  if (kind === 'qualifier') {
    return QUALIFIER_LABEL;
  }
  return `${TOURNAMENT_NAMES[kind]} ${roundName({ round, stage })}`;
}

export function matchPreviewSubject(own: string, opponent: string): string {
  return `まもなくキックオフ: ${own} vs ${opponent}`;
}

export function matchScore(ownVotes: number, opponentVotes: number): string {
  return `${formatCount(ownVotes)}対${formatCount(opponentVotes)}`;
}

const resultSummaryOf = (
  input: MatchResultSubjectInput,
  opponent: string,
): string => {
  const { own, outcome, ownVotes, opponentVotes, nextRoundName } = input;
  switch (outcome) {
    case 'won':
      return nextRoundName === null
        ? `${own}が${matchScore(ownVotes, opponentVotes)}で${opponent}に勝利`
        : `${own}が${opponent}に勝利、次は${nextRoundName}`;
    case 'bye':
      return nextRoundName === null
        ? `${own}は不戦勝`
        : `${own}は不戦勝、次は${nextRoundName}`;
    case 'lost':
      return `${own}は${matchScore(ownVotes, opponentVotes)}で${opponent}に敗れました`;
    case 'no_votes':
      return `${own}と${opponent}は両者敗北(0対0)`;
  }
};

export function matchResultSubject(input: MatchResultSubjectInput): string {
  if (
    input.nextRoundName !== null &&
    input.outcome !== 'won' &&
    input.outcome !== 'bye'
  ) {
    throw new RangeError(
      `翌日の予告と統合できるのは勝利と不戦勝の結果だけです: ${input.outcome}`,
    );
  }
  const opponent = input.opponent ?? UNAVAILABLE_PRODUCT_NAME;
  return `${RESULT_SUBJECT_PREFIX}${resultSummaryOf(input, opponent)}`;
}

export function followedMatchesSubject(
  productNames: readonly string[],
  totalCount: number,
): string {
  if (!Number.isInteger(totalCount) || totalCount < 1) {
    throw new RangeError(
      `開催通知の件数は1以上の整数で指定してください: ${String(totalCount)}`,
    );
  }
  if (totalCount > 1) {
    return `フォローしているユーザーの${formatCount(totalCount)}プロダクト${KICKOFF_CHEER}`;
  }
  const [productName] = productNames;
  if (productName === undefined) {
    throw new RangeError('開催通知の1件のプロダクト名がありません');
  }
  return `${productName}${KICKOFF_CHEER}`;
}

export function awardName(award: AwardKind): string {
  return AWARD_NAMES[award];
}

export function awardSubject(productName: string, award: AwardKind): string {
  return `${productName}が${awardName(award)}を受賞`;
}

const weekPeriodLabel = (period: string): string => {
  if (!WEEK_PERIOD_PATTERN.test(period)) {
    throw new RangeError(
      `Weekの期間はISO週(YYYY-Www)で指定してください: ${period}`,
    );
  }
  const week = parseIsoWeek(period);
  if (week === undefined) {
    throw new RangeError(`存在しないISO週です: ${period}`);
  }
  return formatWeekPeriodLabel(week.weekStart);
};

export function awardPeriodLabel(award: AwardKind, period: string): string {
  if (award === 'product_of_the_week') {
    return weekPeriodLabel(period);
  }
  const year = parseTournamentYear(period);
  if (year === undefined) {
    throw new RangeError(
      `Yearの期間は1年以後の年(YYYY)で指定してください: ${period}`,
    );
  }
  return `${String(year)}年`;
}

export function suppressionReasonOf(
  reason: SuppressionReason,
): NoticeSuppressionReason {
  return SUPPRESSION_REASON_NAMES[reason];
}
