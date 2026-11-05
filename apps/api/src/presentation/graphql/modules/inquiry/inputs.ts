import { z } from 'zod';

import {
  checkGuestNickname,
  checkInquiryBody,
} from '../../../../../common-lib/inquiry/inquiry-input-rules.ts';
import { trimWhiteSpace } from '../../../../../common-lib/text/white-space.ts';
import { invalidCursorError } from '../../../../../lib/core/errors/invalid-cursor.ts';
import {
  INQUIRY_ATTACHMENTS_INVALID_MESSAGES,
  INQUIRY_ERRORS,
} from '../../../../application/inquiry/inquiry-errors.ts';
import { email, inputRuleOf } from '../../auth-inputs.ts';
import { GUEST_NICKNAME_MESSAGES, INQUIRY_BODY_MESSAGES } from './errors.ts';

// 問い合わせ・カテゴリ・ファイルのIDは26文字のULIDで、一致しない値はユースケースが見つからない・添付できないとして扱う。ここでは処理量だけを抑える
const ID_INPUT_MAX_LENGTH = 64;

// カーソルの形式の誤りはストアが位置の指定のエラーにする。ここでは処理量だけを抑える
const CURSOR_INPUT_MAX_LENGTH = 256;

const inquiryId = z
  .string()
  .max(ID_INPUT_MAX_LENGTH, INQUIRY_ERRORS.inquiry_not_found.message);

const categoryId = z
  .string()
  .max(ID_INPUT_MAX_LENGTH, 'カテゴリを選択してください。');

const fileIds = z.array(
  z
    .string()
    .max(ID_INPUT_MAX_LENGTH, INQUIRY_ATTACHMENTS_INVALID_MESSAGES.invalid),
);

// 判定と保存値を食い違わせないよう、入力規則と同じ空白の集合で前後を除く
const guestNickname = inputRuleOf((value) => {
  const issue = checkGuestNickname(value);
  return issue === undefined ? undefined : GUEST_NICKNAME_MESSAGES[issue];
}).transform(trimWhiteSpace);

// 本文は空白や改行に意味があるため、値を変えずに渡す
const inquiryBody = inputRuleOf((value) => {
  const issue = checkInquiryBody(value);
  return issue === undefined ? undefined : INQUIRY_BODY_MESSAGES[issue];
});

export const MY_INQUIRIES_ARGS = z.object({
  after: z
    .string()
    .max(CURSOR_INPUT_MAX_LENGTH, invalidCursorError().message)
    .nullish()
    .transform((value) => value ?? undefined),
});

export const MEMBER_INQUIRY_ARGS = z.object({ id: inquiryId });

export const SUBMIT_GUEST_INQUIRY_ARGS = z.object({
  input: z.object({
    categoryId,
    nickname: guestNickname,
    email,
    body: inquiryBody,
  }),
});

export const SUBMIT_MEMBER_INQUIRY_ARGS = z.object({
  input: z.object({ categoryId, body: inquiryBody, fileIds }),
});

// チャットのメッセージの規則は、返信と共有するユースケースが検証する
export const POST_INQUIRY_MESSAGE_ARGS = z.object({
  inquiryId,
  input: z.object({ body: z.string(), fileIds }),
});
