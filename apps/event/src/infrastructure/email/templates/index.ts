import type { EmailTemplate } from '../rendering/email-template.ts';
import { ADMIN_EMAIL_TEMPLATES } from './admin/index.ts';
import { SMOKE_TEMPLATE } from './email-delivery/smoke-template.ts';
import { IDENTITY_EMAIL_TEMPLATES } from './identity/index.ts';
import { INQUIRY_REPLY_TEMPLATE } from './inquiry/inquiry-reply-template.ts';
import { PAYMENT_EMAIL_TEMPLATES } from './payments/index.ts';
import { ULTRAS_EMAIL_TEMPLATES } from './ultras/index.ts';

export const EMAIL_TEMPLATES: readonly EmailTemplate<unknown>[] = Object.freeze(
  [
    SMOKE_TEMPLATE,
    ...IDENTITY_EMAIL_TEMPLATES,
    ...ADMIN_EMAIL_TEMPLATES,
    INQUIRY_REPLY_TEMPLATE,
    ...PAYMENT_EMAIL_TEMPLATES,
    ...ULTRAS_EMAIL_TEMPLATES,
  ],
);
