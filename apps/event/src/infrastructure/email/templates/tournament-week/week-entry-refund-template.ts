import { TOURNAMENT_WEEK_ENTRY_REFUND_KIND } from '../../../../../lib/core/email/kinds/tournament-week.ts';
import { defineEmailTemplate } from '../../rendering/email-template.ts';
import { WeekEntryRefundEmailBody } from './week-entry-refund-email-body.tsx';
import { weekEntryRefundLead } from './week-entry-refund-lead.ts';

export const WEEK_ENTRY_REFUND_TEMPLATE = defineEmailTemplate({
  kind: TOURNAMENT_WEEK_ENTRY_REFUND_KIND,
  subject: () => 'Weekトーナメントの参加費を返金します',
  preview: weekEntryRefundLead,
  greeting: (input) => input.nickname,
  action: (input) => ({ label: '決済履歴を見る', url: input.billingUrl }),
  Body: WeekEntryRefundEmailBody,
});
