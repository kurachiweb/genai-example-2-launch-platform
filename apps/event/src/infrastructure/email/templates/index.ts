import type { EmailTemplate } from '../rendering/email-template.ts';
import { ADMIN_EMAIL_TEMPLATES } from './admin/index.ts';
import { SMOKE_TEMPLATE } from './email-delivery/smoke-template.ts';
import { IDENTITY_EMAIL_TEMPLATES } from './identity/index.ts';

export const EMAIL_TEMPLATES: readonly EmailTemplate<unknown>[] = Object.freeze(
  [SMOKE_TEMPLATE, ...IDENTITY_EMAIL_TEMPLATES, ...ADMIN_EMAIL_TEMPLATES],
);
