import {
  CHAT_MESSAGE_MESSAGES,
  checkChatMessage,
  checkGuestNickname,
  checkInquiryBody,
  GUEST_NICKNAME_MESSAGES,
  INQUIRY_BODY_MESSAGES,
} from '../../../common-lib/inquiry/inquiry-input-rules.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import { z } from '../../../lib/utilities/validation/zod.ts';
import { email } from '../auth/account-form-schemas.ts';

// APIサーバーの入力の検証と同じ文言にする(文言規則のエラーメッセージ)
const CATEGORY_REQUIRED_MESSAGE = 'カテゴリを選択してください。';

// 1つの欄には最初の1つの違反だけを示す
const ruleOf = (check: (value: string) => string | undefined) =>
  z.string().superRefine((value, context) => {
    const message = check(value);
    if (message !== undefined) {
      context.addIssue({ code: 'custom', message });
    }
  });

const categoryId = ruleOf((value) =>
  value === '' ? CATEGORY_REQUIRED_MESSAGE : undefined,
);

// 判定と送る値を食い違わせないよう、入力規則と同じ空白の集合で前後を除く
const nickname = ruleOf((value) => {
  const issue = checkGuestNickname(value);
  return issue === undefined ? undefined : GUEST_NICKNAME_MESSAGES[issue];
}).transform(trimWhiteSpace);

// 本文は空白や改行に意味があるため、APIサーバーと同じく値を変えずに送る
const body = ruleOf((value) => {
  const issue = checkInquiryBody(value);
  return issue === undefined ? undefined : INQUIRY_BODY_MESSAGES[issue];
});

const chatMessageBody = ruleOf((value) => {
  const issue = checkChatMessage(value);
  return issue === undefined ? undefined : CHAT_MESSAGE_MESSAGES[issue];
});

// 件数と合計の上限は、選んだ時点で添付の入力欄が検査する
const fileIds = z.array(z.string());

export const GUEST_INQUIRY_FORM_SCHEMA = z.object({
  categoryId,
  nickname,
  email,
  body,
});

export type GuestInquiryFormInput = z.input<typeof GUEST_INQUIRY_FORM_SCHEMA>;

export const MEMBER_INQUIRY_FORM_SCHEMA = z.object({
  categoryId,
  body,
  fileIds,
});

export type MemberInquiryFormInput = z.input<typeof MEMBER_INQUIRY_FORM_SCHEMA>;

// 対象の問い合わせは入力欄を持たないため、スキーマの入力に含めず送信の時に足す
export const INQUIRY_MESSAGE_FORM_SCHEMA = z.object({
  body: chatMessageBody,
  fileIds,
});

export type InquiryMessageFormInput = z.input<
  typeof INQUIRY_MESSAGE_FORM_SCHEMA
>;
