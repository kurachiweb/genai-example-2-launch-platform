import type { AnyEmailKind } from '../email-kind.ts';
import { ADMIN_EMAIL_KINDS } from './admin.ts';
import { REPORT_EMAIL_KINDS } from './content-reporting.ts';
import { DATA_EXPORT_EMAIL_KINDS } from './data-export.ts';
import { EMAIL_DELIVERY_SMOKE_KIND } from './email-delivery-smoke.ts';
import { IDENTITY_EMAIL_KINDS } from './identity.ts';
import { INQUIRY_REPLY_NOTIFICATION_KIND } from './inquiry.ts';
import { NOTIFICATION_EMAIL_KINDS } from './notifications.ts';
import { PAYMENTS_EMAIL_KINDS } from './payments.ts';
import { SPONSORSHIP_EMAIL_KINDS } from './sponsorship.ts';
import { TOURNAMENT_WEEK_EMAIL_KINDS } from './tournament-week.ts';
import { TOURNAMENT_YEAR_EMAIL_KINDS } from './tournament-year.ts';
import { MODERATION_EMAIL_KINDS } from './ugc-moderation.ts';
import { ULTRAS_EMAIL_KINDS } from './ultras.ts';

export const EMAIL_KINDS: readonly AnyEmailKind[] = Object.freeze([
  EMAIL_DELIVERY_SMOKE_KIND,
  ...IDENTITY_EMAIL_KINDS,
  ...ADMIN_EMAIL_KINDS,
  INQUIRY_REPLY_NOTIFICATION_KIND,
  ...PAYMENTS_EMAIL_KINDS,
  ...ULTRAS_EMAIL_KINDS,
  ...NOTIFICATION_EMAIL_KINDS,
  ...TOURNAMENT_WEEK_EMAIL_KINDS,
  ...TOURNAMENT_YEAR_EMAIL_KINDS,
  ...SPONSORSHIP_EMAIL_KINDS,
  ...MODERATION_EMAIL_KINDS,
  ...REPORT_EMAIL_KINDS,
  ...DATA_EXPORT_EMAIL_KINDS,
]);
