import type { WeekEntryRefundEmailInput } from '../../../../../lib/core/email/kinds/tournament-week.ts';

export function weekEntryRefundLead({
  weekLabel,
}: WeekEntryRefundEmailInput): string {
  return `${weekLabel}のWeekトーナメントの参加費を返金します。`;
}
