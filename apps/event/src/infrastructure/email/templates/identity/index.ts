import type { EmailTemplate } from '../../rendering/email-template.ts';
import { EMAIL_CHANGE_CONFIRMATION_TEMPLATE } from './email-change-confirmation-template.ts';
import { EMAIL_CHANGED_TEMPLATE } from './email-changed-template.ts';
import { EMAIL_VERIFICATION_TEMPLATE } from './email-verification-template.ts';
import { PASSWORD_CHANGE_CONFIRMATION_TEMPLATE } from './password-change-confirmation-template.ts';
import { PASSWORD_CHANGED_TEMPLATE } from './password-changed-template.ts';
import { PASSWORD_RESET_COMPLETED_TEMPLATE } from './password-reset-completed-template.ts';
import { PASSWORD_RESET_TEMPLATE } from './password-reset-template.ts';

export const IDENTITY_EMAIL_TEMPLATES: readonly EmailTemplate<unknown>[] =
  Object.freeze([
    EMAIL_VERIFICATION_TEMPLATE,
    EMAIL_CHANGE_CONFIRMATION_TEMPLATE,
    EMAIL_CHANGED_TEMPLATE,
    PASSWORD_RESET_TEMPLATE,
    PASSWORD_RESET_COMPLETED_TEMPLATE,
    PASSWORD_CHANGE_CONFIRMATION_TEMPLATE,
    PASSWORD_CHANGED_TEMPLATE,
  ]);
