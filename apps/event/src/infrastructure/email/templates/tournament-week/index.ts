import type { EmailTemplate } from '../../rendering/email-template.ts';
import { WEEK_ENTRY_REFUND_TEMPLATE } from './week-entry-refund-template.ts';

export const TOURNAMENT_WEEK_EMAIL_TEMPLATES: readonly EmailTemplate<unknown>[] =
  Object.freeze([WEEK_ENTRY_REFUND_TEMPLATE]);
