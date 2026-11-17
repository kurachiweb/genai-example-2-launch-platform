import type { YearEntryRefundEmailInput } from '../../../../../lib/core/email/kinds/tournament-year.ts';

export function yearEntryRefundLead({
  yearLabel,
}: YearEntryRefundEmailInput): string {
  return `${yearLabel}のYearトーナメントの参加費を返金します。`;
}
