import type { ClientMyYearEntryQuery } from '../../graphql/generated/graphql.ts';
import type { TournamentEntryExcludedReason } from '../tournament/tournament-copy.ts';
import type { TournamentEntryInput } from '../tournament/tournament-entry-model.ts';

export type YearEntryPanelView = NonNullable<
  ClientMyYearEntryQuery['myYearEntry']
>;

const excludedReasonOf = (
  closeReason: YearEntryPanelView['closeReason'],
): TournamentEntryExcludedReason | null => {
  switch (closeReason) {
    case 'HIDDEN_OR_SUSPENDED':
      return 'hidden_or_suspended';
    case 'OVER_CAPACITY':
      return 'over_capacity';
    default:
      return null;
  }
};

// Yearの参加費の導線はUltrasの案内を添えず、プロダクトを表示できない間も押下の後の拒否で理由を示す。
// 返金の対象は、決済の有無と返金の依頼の状態を知るサーバーの値に従う
export function yearEntryInputOf(
  entry: YearEntryPanelView,
): TournamentEntryInput {
  return {
    launchId: entry.launchId,
    status: entry.status,
    late: entry.closeReason === 'LATE_ENTRY',
    excludedReason: excludedReasonOf(entry.closeReason),
    exempt: entry.exempt,
    refundable: entry.refundable,
    acceptUntil: entry.acceptUntil,
    drawAt: entry.drawAt,
    serverTime: entry.serverTime,
    feeAmount: entry.fee?.amount ?? null,
    ultrasGuide: false,
    blockedReason: null,
    progress: entry.progress,
    bracketPath: entry.bracketPath,
  };
}
