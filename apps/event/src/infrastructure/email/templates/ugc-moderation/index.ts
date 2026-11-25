import type { EmailTemplate } from '../../rendering/email-template.ts';
import { MODERATION_COMMENT_HIDDEN_TEMPLATE } from './comment-hidden-template.ts';
import { MODERATION_PRODUCT_HIDDEN_TEMPLATE } from './product-hidden-template.ts';
import { MODERATION_USER_SUSPENDED_TEMPLATE } from './user-suspended-template.ts';

export const MODERATION_EMAIL_TEMPLATES: readonly EmailTemplate<unknown>[] =
  Object.freeze([
    MODERATION_USER_SUSPENDED_TEMPLATE,
    MODERATION_PRODUCT_HIDDEN_TEMPLATE,
    MODERATION_COMMENT_HIDDEN_TEMPLATE,
  ]);
