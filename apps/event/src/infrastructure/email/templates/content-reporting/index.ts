import type { EmailTemplate } from '../../rendering/email-template.ts';
import { REPORT_INFRINGEMENT_INQUIRY_TEMPLATE } from './infringement-inquiry-template.ts';
import { REPORT_REJECTION_TO_POSTER_TEMPLATE } from './rejection-to-poster-template.ts';
import { REPORT_OUTCOME_TEMPLATE } from './report-outcome-template.ts';

export const REPORT_EMAIL_TEMPLATES: readonly EmailTemplate<unknown>[] =
  Object.freeze([
    REPORT_OUTCOME_TEMPLATE,
    REPORT_REJECTION_TO_POSTER_TEMPLATE,
    REPORT_INFRINGEMENT_INQUIRY_TEMPLATE,
  ]);
