import type { LaunchStatus, QualifierOutcome } from './launch-status.ts';

export interface LaunchSummaryView {
  readonly label: string;
  readonly inMatch: boolean;
}

export type AwardKind = 'week' | 'year';

export interface AwardEntry {
  readonly kind: AwardKind;
  readonly label: string;
}

export interface AwardGroup {
  readonly kind: AwardKind;
  readonly count: number;
  readonly labels: readonly string[];
}

const SCHEDULED_SUMMARY: LaunchSummaryView = Object.freeze({
  label: 'キックオフ予定',
  inMatch: false,
});

const STATUS_SUMMARIES: Readonly<
  Record<Exclude<LaunchStatus, 'finished'>, LaunchSummaryView>
> = Object.freeze({
  scheduled: SCHEDULED_SUMMARY,
  paired: SCHEDULED_SUMMARY,
  in_progress: Object.freeze({ label: '予選マッチ中', inMatch: true }),
  canceled: Object.freeze({ label: '取消', inMatch: false }),
});

const OUTCOME_SUMMARIES: Readonly<Record<QualifierOutcome, LaunchSummaryView>> =
  Object.freeze({
    won: Object.freeze({ label: 'ディレクトリ掲載', inMatch: false }),
    lost: Object.freeze({ label: '予選敗北', inMatch: false }),
  });

const AWARD_KIND_ORDER: readonly AwardKind[] = Object.freeze(['year', 'week']);

export function fallbackLaunchSummary(launch: {
  readonly status: LaunchStatus;
  readonly outcome: QualifierOutcome | null;
}): LaunchSummaryView {
  if (launch.status !== 'finished') {
    return STATUS_SUMMARIES[launch.status];
  }
  if (launch.outcome === null) {
    throw new RangeError('終了したローンチに予選の結果がありません');
  }
  return OUTCOME_SUMMARIES[launch.outcome];
}

export function groupAwards(
  awards: readonly AwardEntry[],
): readonly AwardGroup[] {
  return Object.freeze(
    AWARD_KIND_ORDER.flatMap((kind) => {
      const labels = awards
        .filter((award) => award.kind === kind)
        .map(({ label }) => label);
      return labels.length === 0
        ? []
        : [
            Object.freeze({
              kind,
              count: labels.length,
              labels: Object.freeze(labels),
            }),
          ];
    }),
  );
}
