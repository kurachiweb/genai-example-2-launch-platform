import { REPORT_INFRINGEMENT_INQUIRY_EMAIL } from '../../../../../lib/core/email/kinds/content-reporting.ts';
import { defineEmailTemplate } from '../../rendering/email-template.ts';
import { InfringementInquiryEmailBody } from './infringement-inquiry-email-body.tsx';
import {
  CONTACT_ACTION_LABEL,
  INFRINGEMENT_INQUIRY_SUBJECT,
  infringementInquiryLead,
} from './report-notice-copy.ts';

export const REPORT_INFRINGEMENT_INQUIRY_TEMPLATE = defineEmailTemplate({
  kind: REPORT_INFRINGEMENT_INQUIRY_EMAIL,
  subject: () => INFRINGEMENT_INQUIRY_SUBJECT,
  preview: (input) => infringementInquiryLead(input),
  greeting: (input) => input.nickname,
  action: (input) => ({ label: CONTACT_ACTION_LABEL, url: input.contactUrl }),
  Body: InfringementInquiryEmailBody,
});
