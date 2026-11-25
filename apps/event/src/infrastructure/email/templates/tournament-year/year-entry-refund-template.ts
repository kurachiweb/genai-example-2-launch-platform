import { TOURNAMENT_YEAR_ENTRY_REFUND_KIND } from '../../../../../lib/core/email/kinds/tournament-year.ts';
import { defineEmailTemplate } from '../../rendering/email-template.ts';
import { YearEntryRefundEmailBody } from './year-entry-refund-email-body.tsx';
import { yearEntryRefundLead } from './year-entry-refund-lead.ts';

export const YEAR_ENTRY_REFUND_TEMPLATE = defineEmailTemplate({
  kind: TOURNAMENT_YEAR_ENTRY_REFUND_KIND,
  subject: () => 'Yearトーナメントの参加費を返金します',
  preview: yearEntryRefundLead,
  greeting: (input) => input.nickname,
  action: (input) => ({ label: '決済履歴を見る', url: input.billingUrl }),
  Body: YearEntryRefundEmailBody,
});
