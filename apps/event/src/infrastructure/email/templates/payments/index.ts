import type { EmailTemplate } from '../../rendering/email-template.ts';
import { AUTOMATIC_REFUND_TEMPLATE } from './automatic-refund-template.ts';
import { PURCHASE_CONFIRMATION_TEMPLATE } from './purchase-confirmation-template.ts';

export const PAYMENT_EMAIL_TEMPLATES: readonly EmailTemplate<unknown>[] =
  Object.freeze([PURCHASE_CONFIRMATION_TEMPLATE, AUTOMATIC_REFUND_TEMPLATE]);
