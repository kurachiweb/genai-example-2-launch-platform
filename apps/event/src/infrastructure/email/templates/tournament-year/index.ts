import type { EmailTemplate } from '../../rendering/email-template.ts';
import { YEAR_ENTRY_REFUND_TEMPLATE } from './year-entry-refund-template.ts';

export const TOURNAMENT_YEAR_EMAIL_TEMPLATES: readonly EmailTemplate<unknown>[] =
  Object.freeze([YEAR_ENTRY_REFUND_TEMPLATE]);
