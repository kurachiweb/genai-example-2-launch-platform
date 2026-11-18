import type { EmailTemplate } from '../../rendering/email-template.ts';
import { SPONSORSHIP_END_NOTICE_TEMPLATE } from './sponsorship-end-notice-template.ts';
import { SPONSORSHIP_START_NOTICE_TEMPLATE } from './sponsorship-start-notice-template.ts';
import { SPONSORSHIP_TERMINATION_NOTICE_TEMPLATE } from './sponsorship-termination-notice-template.ts';

export const SPONSORSHIP_EMAIL_TEMPLATES: readonly EmailTemplate<unknown>[] =
  Object.freeze([
    SPONSORSHIP_START_NOTICE_TEMPLATE,
    SPONSORSHIP_END_NOTICE_TEMPLATE,
    SPONSORSHIP_TERMINATION_NOTICE_TEMPLATE,
  ]);
