import type { TournamentEntryInput } from '../tournament/tournament-entry-model.ts';
import type { WeekEntryPanelView } from './week-entry-model.ts';

// Weekに参加数の上限は無く、除外の理由はプロダクトが公開されていないことだけ。
// Ultrasの特典で免除された枠は参加費を決済していないため、免除でない枠だけを返金の対象にする
export function weekEntryInputOf(
  entry: WeekEntryPanelView,
): TournamentEntryInput {
  return {
    launchId: entry.launchId,
    status: entry.status,
    late: entry.closeReason === 'LATE_ENTRY',
    excludedReason:
      entry.closeReason === 'HIDDEN_OR_SUSPENDED'
        ? 'hidden_or_suspended'
        : null,
    exempt: entry.exempt,
    refundable: !entry.exempt,
    acceptUntil: entry.acceptUntil,
    drawAt: entry.drawAt,
    serverTime: entry.serverTime,
    feeAmount: entry.fee?.amount ?? null,
    ultrasGuide: entry.ultrasGuide,
    blockedReason: entry.checkoutBlock?.message ?? null,
    progress: entry.progress,
    bracketPath: entry.bracketPath,
  };
}
