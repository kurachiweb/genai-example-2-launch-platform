import { SPONSORSHIP_START_NOTICE_EMAIL } from '../../../../../lib/core/email/kinds/sponsorship.ts';
import { defineEmailTemplate } from '../../rendering/email-template.ts';
import { SponsorshipStartNoticeEmailBody } from './sponsorship-start-notice-email-body.tsx';
import {
  LIST_ACTION_LABEL,
  startNoticeLead,
} from './sponsorship-notice-copy.ts';

export const SPONSORSHIP_START_NOTICE_TEMPLATE = defineEmailTemplate({
  kind: SPONSORSHIP_START_NOTICE_EMAIL,
  subject: (input) => `${input.productName}のスポンサー広告掲載が始まりました`,
  preview: (input) => startNoticeLead(input),
  greeting: (input) => input.nickname,
  action: (input) => ({ label: LIST_ACTION_LABEL, url: input.listUrl }),
  Body: SponsorshipStartNoticeEmailBody,
});
