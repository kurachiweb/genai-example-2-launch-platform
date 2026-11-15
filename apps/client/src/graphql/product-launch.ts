import type {
  LaunchStatus,
  ProductAwardKind,
  QualifierOutcome,
} from './generated/graphql.ts';

export type ProductLaunchStatus =
  'scheduled' | 'paired' | 'in_progress' | 'finished' | 'canceled';

export type ProductLaunchOutcome = 'won' | 'lost';

export interface ProductLaunchView {
  readonly id: string;
  // 取消を除いて古い順に1から数える。取消は0
  readonly number: number;
  // 業務日付(YYYY-MM-DD)。利用者のタイムゾーンで日がずれるため日時の表示部品へ渡さない
  readonly launchDate: string;
  readonly kickoffAt: string;
  readonly status: ProductLaunchStatus;
  readonly outcome: ProductLaunchOutcome | null;
  readonly summary: { readonly label: string; readonly inMatch: boolean };
}

export type ProductAwardKindView = 'week' | 'year';

export interface ProductAwardView {
  readonly kind: ProductAwardKindView;
  readonly count: number;
  readonly labels: readonly string[];
}

export interface GraphQLProductLaunch {
  readonly id: string;
  readonly number: number;
  readonly launchDate: string;
  readonly kickoffAt: string;
  readonly status: LaunchStatus;
  readonly outcome: QualifierOutcome | null;
  readonly summary: { readonly label: string; readonly inMatch: boolean };
}

interface GraphQLProductAward {
  readonly kind: ProductAwardKind;
  readonly count: number;
  readonly labels: readonly string[];
}

const LAUNCH_STATUS_OF: Readonly<Record<LaunchStatus, ProductLaunchStatus>> =
  Object.freeze({
    SCHEDULED: 'scheduled',
    PAIRED: 'paired',
    IN_PROGRESS: 'in_progress',
    FINISHED: 'finished',
    CANCELED: 'canceled',
  });

const OUTCOME_OF: Readonly<Record<QualifierOutcome, ProductLaunchOutcome>> =
  Object.freeze({ WON: 'won', LOST: 'lost' });

const AWARD_KIND_OF: Readonly<Record<ProductAwardKind, ProductAwardKindView>> =
  Object.freeze({ WEEK: 'week', YEAR: 'year' });

export const toProductLaunchView = ({
  id,
  number,
  launchDate,
  kickoffAt,
  status,
  outcome,
  summary,
}: GraphQLProductLaunch): ProductLaunchView => ({
  id,
  number,
  launchDate,
  kickoffAt,
  status: LAUNCH_STATUS_OF[status],
  outcome: outcome === null ? null : OUTCOME_OF[outcome],
  summary: { label: summary.label, inMatch: summary.inMatch },
});

export const toProductAwardView = ({
  kind,
  count,
  labels,
}: GraphQLProductAward): ProductAwardView => ({
  kind: AWARD_KIND_OF[kind],
  count,
  labels: [...labels],
});
