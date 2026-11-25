import { checkInquiryMessage } from '../../../../common-lib/reporting/report-case-rules.ts';
import { REASON_SCHEMAS } from '../../../../lib/components/admin/reason-schema.ts';
import { z } from '../../../../lib/utilities/validation/zod.ts';
import { INQUIRY_MESSAGE_ERROR_MESSAGES } from './report-case-messages.ts';

// 照会の内容は改行に意味があるため、APIサーバーと同じく前後の空白を除いて数え、値は変えずに送る
const message = z.string().superRefine((value, context) => {
  const check = checkInquiryMessage(value);
  if (check !== 'ok') {
    context.addIssue({
      code: 'custom',
      message: INQUIRY_MESSAGE_ERROR_MESSAGES[check],
    });
  }
});

export const INFRINGEMENT_INQUIRY_FORM_SCHEMA = z.object({
  message,
  reason: REASON_SCHEMAS.optional,
});

export interface InfringementInquiryFormInput {
  readonly message: string;
  readonly reason: string;
}

export interface InfringementInquiryFormOutput {
  readonly message: string;
  readonly reason?: string | undefined;
}
