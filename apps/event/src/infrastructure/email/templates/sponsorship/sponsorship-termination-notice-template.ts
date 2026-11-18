import { SPONSORSHIP_TERMINATION_NOTICE_EMAIL } from '../../../../../lib/core/email/kinds/sponsorship.ts';
import { defineEmailTemplate } from '../../rendering/email-template.ts';
import { SponsorshipTerminationNoticeEmailBody } from './sponsorship-termination-notice-email-body.tsx';
import {
  LIST_ACTION_LABEL,
  terminationNoticeLead,
} from './sponsorship-notice-copy.ts';

export const SPONSORSHIP_TERMINATION_NOTICE_TEMPLATE = defineEmailTemplate({
  kind: SPONSORSHIP_TERMINATION_NOTICE_EMAIL,
  subject: (input) => `${input.productName}のスポンサー広告掲載を終了しました`,
  preview: (input) => terminationNoticeLead(input),
  greeting: (input) => input.nickname,
  action: (input) => ({ label: LIST_ACTION_LABEL, url: input.listUrl }),
  Body: SponsorshipTerminationNoticeEmailBody,
});
