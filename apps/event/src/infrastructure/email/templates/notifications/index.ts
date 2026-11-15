import type { EmailTemplate } from '../../rendering/email-template.ts';
import { FOLLOWED_USER_AWARD_TEMPLATE } from './followed-user-award-template.ts';
import { FOLLOWED_USER_MATCHES_TEMPLATE } from './followed-user-matches-template.ts';
import { MATCH_PREVIEW_TEMPLATE } from './match-preview-template.ts';
import { MATCH_RESULT_TEMPLATE } from './match-result-template.ts';

export const NOTIFICATION_EMAIL_TEMPLATES: readonly EmailTemplate<unknown>[] =
  Object.freeze([
    MATCH_PREVIEW_TEMPLATE,
    MATCH_RESULT_TEMPLATE,
    FOLLOWED_USER_MATCHES_TEMPLATE,
    FOLLOWED_USER_AWARD_TEMPLATE,
  ]);
