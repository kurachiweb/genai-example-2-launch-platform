import {
  CHAT_MESSAGE_MESSAGES,
  checkChatMessage,
} from '../../../common-lib/inquiry/inquiry-input-rules.ts';
import { REASON_SCHEMAS } from '../../../lib/components/admin/reason-schema.ts';
import { z } from '../../../lib/utilities/validation/zod.ts';

// 本文は空白や改行に意味があるため、APIサーバーと同じく値を変えずに送る
const body = z.string().superRefine((value, context) => {
  const issue = checkChatMessage(value);
  if (issue !== undefined) {
    context.addIssue({ code: 'custom', message: CHAT_MESSAGE_MESSAGES[issue] });
  }
});

// 対象の問い合わせは入力欄を持たないため、スキーマの入力に含めず送信の時に足す
export const INQUIRY_REPLY_FORM_SCHEMA = z.object({
  body,
  reason: REASON_SCHEMAS.optional,
});

export type InquiryReplyFormInput = z.input<typeof INQUIRY_REPLY_FORM_SCHEMA>;
