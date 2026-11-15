import type { EmailTemplate } from '../../rendering/email-template.ts';
import { CANCELLATION_ACCEPTED_TEMPLATE } from './cancellation-accepted-template.ts';
import { PAYMENT_FAILED_TEMPLATE } from './payment-failed-template.ts';

export const ULTRAS_EMAIL_TEMPLATES: readonly EmailTemplate<unknown>[] =
  Object.freeze([PAYMENT_FAILED_TEMPLATE, CANCELLATION_ACCEPTED_TEMPLATE]);
