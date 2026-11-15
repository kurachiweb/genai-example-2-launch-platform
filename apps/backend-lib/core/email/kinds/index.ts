import type { AnyEmailKind } from '../email-kind.ts';
import { ADMIN_EMAIL_KINDS } from './admin.ts';
import { EMAIL_DELIVERY_SMOKE_KIND } from './email-delivery-smoke.ts';
import { IDENTITY_EMAIL_KINDS } from './identity.ts';
import { INQUIRY_REPLY_NOTIFICATION_KIND } from './inquiry.ts';
import { PAYMENTS_EMAIL_KINDS } from './payments.ts';
import { ULTRAS_EMAIL_KINDS } from './ultras.ts';

export const EMAIL_KINDS: readonly AnyEmailKind[] = Object.freeze([
  EMAIL_DELIVERY_SMOKE_KIND,
  ...IDENTITY_EMAIL_KINDS,
  ...ADMIN_EMAIL_KINDS,
  INQUIRY_REPLY_NOTIFICATION_KIND,
  ...PAYMENTS_EMAIL_KINDS,
  ...ULTRAS_EMAIL_KINDS,
]);
