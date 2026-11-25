import { z } from 'zod';

import {
  INQUIRY_MESSAGE_MAX,
  REPORT_ADMIN_REASON_MAX,
  REPORT_NOTICE_EXCERPT_MAX,
} from '../../../../common-lib/reporting/report-case-rules.ts';
import { REPORT_TARGET_KINDS } from '../../../../common-lib/reporting/report-rules.ts';
import { countGraphemes } from '../../../../common-lib/text/graphemes.ts';
import { trimWhiteSpace } from '../../../../common-lib/text/white-space.ts';
import { type AnyEmailKind, defineEmailKind } from '../email-kind.ts';
import { linkUrlSchema as linkUrl } from './link-url.ts';

const text = z.string().min(1);

const utcDateTime = z.iso.datetime();

const targetKind = z.enum(REPORT_TARGET_KINDS);

// 管理画面の上限は書記素で数えるため、絵文字を含む値も同じ数え方で受け付ける
function boundedText(max: number, label: string) {
  return text
    .refine((value) => trimWhiteSpace(value) !== '', {
      message: `${label}を指定してください`,
    })
    .refine((value) => countGraphemes(value) <= max, {
      message: `${label}は${String(max)}文字以内で指定してください`,
    });
}

const reason = boundedText(REPORT_ADMIN_REASON_MAX, '理由');

const message = boundedText(INQUIRY_MESSAGE_MAX, '照会の内容');

const excerpt = text
  .refine((value) => countGraphemes(value) <= REPORT_NOTICE_EXCERPT_MAX, {
    message: `抜粋は${String(REPORT_NOTICE_EXCERPT_MAX)}文字以内で指定してください`,
  })
  .nullable();

const target = {
  targetKind,
  targetLabel: text.nullable(),
  excerpt,
};

const reportOutcomeInput = z.object({
  recipientName: text.nullable(),
  outcome: z.enum(['resolved', 'rejected']),
  ...target,
  reason,
  decidedAt: utcDateTime,
  contactUrl: linkUrl,
});

// 申出者を特定できる情報と申出者の理由を投稿者へ渡さないよう、投稿者向けの入力はそれらの項目を持たない
const rejectionToPosterInput = z.object({
  nickname: text,
  ...target,
  reason,
  decidedAt: utcDateTime,
  contactUrl: linkUrl,
});

const infringementInquiryInput = z.object({
  nickname: text,
  ...target,
  targetUrl: linkUrl,
  message,
  sentAt: utcDateTime,
  deadline: utcDateTime,
  contactUrl: linkUrl,
});

export type ReportOutcomeInput = z.infer<typeof reportOutcomeInput>;

export type ReportRejectionToPosterInput = z.infer<
  typeof rejectionToPosterInput
>;

export type ReportInfringementInquiryInput = z.infer<
  typeof infringementInquiryInput
>;

export const REPORT_OUTCOME_EMAIL = defineEmailKind({
  name: 'content-reporting.report-outcome',
  category: 'transactional',
  inputSchema: reportOutcomeInput,
});

export const REPORT_REJECTION_TO_POSTER_EMAIL = defineEmailKind({
  name: 'content-reporting.rejection-to-poster',
  category: 'transactional',
  inputSchema: rejectionToPosterInput,
});

export const REPORT_INFRINGEMENT_INQUIRY_EMAIL = defineEmailKind({
  name: 'content-reporting.infringement-inquiry',
  category: 'transactional',
  inputSchema: infringementInquiryInput,
});

export const REPORT_EMAIL_KINDS: readonly AnyEmailKind[] = Object.freeze([
  REPORT_OUTCOME_EMAIL,
  REPORT_REJECTION_TO_POSTER_EMAIL,
  REPORT_INFRINGEMENT_INQUIRY_EMAIL,
]);
