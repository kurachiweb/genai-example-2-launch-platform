import type { EmailTemplate } from '../rendering/email-template.ts';
import { ADMIN_EMAIL_TEMPLATES } from './admin/index.ts';
import { REPORT_EMAIL_TEMPLATES } from './content-reporting/index.ts';
import { DATA_EXPORT_EMAIL_TEMPLATES } from './data-export/index.ts';
import { SMOKE_TEMPLATE } from './email-delivery/smoke-template.ts';
import { IDENTITY_EMAIL_TEMPLATES } from './identity/index.ts';
import { INQUIRY_REPLY_TEMPLATE } from './inquiry/inquiry-reply-template.ts';
import { NOTIFICATION_EMAIL_TEMPLATES } from './notifications/index.ts';
import { PAYMENT_EMAIL_TEMPLATES } from './payments/index.ts';
import { SPONSORSHIP_EMAIL_TEMPLATES } from './sponsorship/index.ts';
import { TOURNAMENT_WEEK_EMAIL_TEMPLATES } from './tournament-week/index.ts';
import { TOURNAMENT_YEAR_EMAIL_TEMPLATES } from './tournament-year/index.ts';
import { MODERATION_EMAIL_TEMPLATES } from './ugc-moderation/index.ts';
import { ULTRAS_EMAIL_TEMPLATES } from './ultras/index.ts';

export const EMAIL_TEMPLATES: readonly EmailTemplate<unknown>[] = Object.freeze(
  [
    SMOKE_TEMPLATE,
    ...IDENTITY_EMAIL_TEMPLATES,
    ...ADMIN_EMAIL_TEMPLATES,
    INQUIRY_REPLY_TEMPLATE,
    ...PAYMENT_EMAIL_TEMPLATES,
    ...ULTRAS_EMAIL_TEMPLATES,
    ...NOTIFICATION_EMAIL_TEMPLATES,
    ...TOURNAMENT_WEEK_EMAIL_TEMPLATES,
    ...TOURNAMENT_YEAR_EMAIL_TEMPLATES,
    ...SPONSORSHIP_EMAIL_TEMPLATES,
    ...MODERATION_EMAIL_TEMPLATES,
    ...REPORT_EMAIL_TEMPLATES,
    ...DATA_EXPORT_EMAIL_TEMPLATES,
  ],
);
