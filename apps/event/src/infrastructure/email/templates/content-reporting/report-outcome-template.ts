import { REPORT_OUTCOME_EMAIL } from '../../../../../lib/core/email/kinds/content-reporting.ts';
import { defineEmailTemplate } from '../../rendering/email-template.ts';
import {
  CONTACT_ACTION_LABEL,
  REPORT_OUTCOME_SUBJECT,
  reportOutcomeLead,
} from './report-notice-copy.ts';
import { ReportOutcomeEmailBody } from './report-outcome-email-body.tsx';

export const REPORT_OUTCOME_TEMPLATE = defineEmailTemplate({
  kind: REPORT_OUTCOME_EMAIL,
  subject: () => REPORT_OUTCOME_SUBJECT,
  preview: (input) => reportOutcomeLead(input.outcome, input),
  greeting: (input) => input.recipientName ?? undefined,
  action: (input) => ({ label: CONTACT_ACTION_LABEL, url: input.contactUrl }),
  Body: ReportOutcomeEmailBody,
});
