import type { EmailTemplate } from '../../rendering/email-template.ts';
import { ADMIN_EMAIL_CHANGE_CONFIRMATION_TEMPLATE } from './admin-email-change-confirmation-template.ts';
import { ADMIN_EMAIL_CHANGED_TEMPLATE } from './admin-email-changed-template.ts';
import { ADMIN_INVITATION_TEMPLATE } from './admin-invitation-template.ts';
import { ADMIN_PASSWORD_CHANGED_TEMPLATE } from './admin-password-changed-template.ts';
import { ADMIN_PASSWORD_RESET_COMPLETED_TEMPLATE } from './admin-password-reset-completed-template.ts';
import { ADMIN_PASSWORD_RESET_TEMPLATE } from './admin-password-reset-template.ts';

export const ADMIN_EMAIL_TEMPLATES: readonly EmailTemplate<unknown>[] =
  Object.freeze([
    ADMIN_INVITATION_TEMPLATE,
    ADMIN_EMAIL_CHANGE_CONFIRMATION_TEMPLATE,
    ADMIN_EMAIL_CHANGED_TEMPLATE,
    ADMIN_PASSWORD_RESET_TEMPLATE,
    ADMIN_PASSWORD_RESET_COMPLETED_TEMPLATE,
    ADMIN_PASSWORD_CHANGED_TEMPLATE,
  ]);
