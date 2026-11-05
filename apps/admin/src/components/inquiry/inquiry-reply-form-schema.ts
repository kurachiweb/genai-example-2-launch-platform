import {
  CHAT_MESSAGE_MAX,
  checkChatMessage,
  type InquiryTextIssue,
} from '../../../common-lib/inquiry/inquiry-input-rules.ts';
import { REASON_SCHEMAS } from '../../../lib/components/admin/reason-schema.ts';
import { z } from '../../../lib/utilities/validation/zod.ts';

const limitFormat = new Intl.NumberFormat('ja-JP');

// APIサーバーの返信の本文の検証と同じ文言にする
export const REPLY_BODY_MESSAGES: Readonly<Record<InquiryTextIssue, string>> =
  Object.freeze({
    'forbidden-character': 'メッセージに使用できない文字が含まれています。',
    empty: 'メッセージを入力してください。',
    'too-long': `メッセージは${limitFormat.format(CHAT_MESSAGE_MAX)}文字以内で入力してください。`,
  });

// 本文は空白や改行に意味があるため、APIサーバーと同じく値を変えずに送る
const body = z.string().superRefine((value, context) => {
  const issue = checkChatMessage(value);
  if (issue !== undefined) {
    context.addIssue({ code: 'custom', message: REPLY_BODY_MESSAGES[issue] });
  }
});

// 対象の問い合わせは入力欄を持たないため、スキーマの入力に含めず送信の時に足す
export const INQUIRY_REPLY_FORM_SCHEMA = z.object({
  body,
  reason: REASON_SCHEMAS.optional,
});

export type InquiryReplyFormInput = z.input<typeof INQUIRY_REPLY_FORM_SCHEMA>;
