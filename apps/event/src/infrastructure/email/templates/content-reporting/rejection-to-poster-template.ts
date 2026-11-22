import { REPORT_REJECTION_TO_POSTER_EMAIL } from '../../../../../lib/core/email/kinds/content-reporting.ts';
import { defineEmailTemplate } from '../../rendering/email-template.ts';
import { RejectionToPosterEmailBody } from './rejection-to-poster-email-body.tsx';
import {
  CONTACT_ACTION_LABEL,
  posterRejectionLead,
  REPORT_OUTCOME_SUBJECT,
} from './report-notice-copy.ts';

export const REPORT_REJECTION_TO_POSTER_TEMPLATE = defineEmailTemplate({
  kind: REPORT_REJECTION_TO_POSTER_EMAIL,
  subject: () => REPORT_OUTCOME_SUBJECT,
  preview: (input) => posterRejectionLead(input),
  greeting: (input) => input.nickname,
  action: (input) => ({ label: CONTACT_ACTION_LABEL, url: input.contactUrl }),
  Body: RejectionToPosterEmailBody,
});
