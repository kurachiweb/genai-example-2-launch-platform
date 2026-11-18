import { SPONSORSHIP_END_NOTICE_EMAIL } from '../../../../../lib/core/email/kinds/sponsorship.ts';
import { defineEmailTemplate } from '../../rendering/email-template.ts';
import { SponsorshipEndNoticeEmailBody } from './sponsorship-end-notice-email-body.tsx';
import { LIST_ACTION_LABEL, endNoticeLead } from './sponsorship-notice-copy.ts';

export const SPONSORSHIP_END_NOTICE_TEMPLATE = defineEmailTemplate({
  kind: SPONSORSHIP_END_NOTICE_EMAIL,
  subject: (input) =>
    `${input.productName}のスポンサー広告掲載期間が終了しました`,
  preview: (input) => endNoticeLead(input),
  greeting: (input) => input.nickname,
  action: (input) => ({ label: LIST_ACTION_LABEL, url: input.listUrl }),
  Body: SponsorshipEndNoticeEmailBody,
});
