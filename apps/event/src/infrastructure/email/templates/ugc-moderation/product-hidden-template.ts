import { MODERATION_PRODUCT_HIDDEN_EMAIL } from '../../../../../lib/core/email/kinds/ugc-moderation.ts';
import { defineEmailTemplate } from '../../rendering/email-template.ts';
import {
  CONTACT_ACTION_LABEL,
  productHiddenLead,
} from './moderation-notice-copy.ts';
import { ProductHiddenEmailBody } from './product-hidden-email-body.tsx';

export const MODERATION_PRODUCT_HIDDEN_TEMPLATE = defineEmailTemplate({
  kind: MODERATION_PRODUCT_HIDDEN_EMAIL,
  subject: () => 'プロダクトの公開が停止されました',
  preview: (input) => productHiddenLead(input.productName),
  greeting: (input) => input.nickname,
  action: (input) => ({ label: CONTACT_ACTION_LABEL, url: input.contactUrl }),
  Body: ProductHiddenEmailBody,
});
