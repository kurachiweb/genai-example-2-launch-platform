import {
  checkGuestNickname,
  checkInquiryBody,
  GUEST_NICKNAME_MAX,
  INQUIRY_BODY_MAX,
  type InquiryTextIssue,
} from '../../../common-lib/inquiry/inquiry-input-rules.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import { z } from '../../../lib/utilities/validation/zod.ts';
import { email } from '../auth/account-form-schemas.ts';

const limitFormat = new Intl.NumberFormat('ja-JP');

// APIサーバーの入力の検証と同じ文言にする(文言規則のエラーメッセージ)
const CATEGORY_REQUIRED_MESSAGE = 'カテゴリを選択してください。';

const NICKNAME_MESSAGES: Readonly<Record<InquiryTextIssue, string>> =
  Object.freeze({
    'forbidden-character': 'ニックネームに使用できない文字が含まれています。',
    empty: 'ニックネームを入力してください。',
    'too-long': `ニックネームは${limitFormat.format(GUEST_NICKNAME_MAX)}文字以内で入力してください。`,
  });

const BODY_MESSAGES: Readonly<Record<InquiryTextIssue, string>> = Object.freeze(
  {
    'forbidden-character': 'メッセージに使用できない文字が含まれています。',
    empty: 'メッセージを入力してください。',
    'too-long': `メッセージは${limitFormat.format(INQUIRY_BODY_MAX)}文字以内で入力してください。`,
  },
);

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
  return issue === undefined ? undefined : NICKNAME_MESSAGES[issue];
}).transform(trimWhiteSpace);

// 本文は空白や改行に意味があるため、APIサーバーと同じく値を変えずに送る
const body = ruleOf((value) => {
  const issue = checkInquiryBody(value);
  return issue === undefined ? undefined : BODY_MESSAGES[issue];
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
