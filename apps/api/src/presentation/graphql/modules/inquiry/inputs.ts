import { z } from 'zod';

import { checkAuditReason } from '../../../../../common-lib/admin/admin-input-rules.ts';
import {
  checkGuestNickname,
  checkInquiryBody,
  INQUIRY_CURSOR_MAX,
} from '../../../../../common-lib/inquiry/inquiry-input-rules.ts';
import { trimWhiteSpace } from '../../../../../common-lib/text/white-space.ts';
import { invalidCursorError } from '../../../../../lib/core/errors/invalid-cursor.ts';
import {
  INQUIRY_ATTACHMENTS_INVALID_MESSAGES,
  INQUIRY_ERRORS,
} from '../../../../application/inquiry/inquiry-errors.ts';
import type { AdminInquiryFilter } from '../../../../application/inquiry/ports.ts';
import { email, inputRuleOf } from '../../auth-inputs.ts';
import {
  AUDIT_REASON_TOO_LONG_MESSAGE,
  GUEST_NICKNAME_MESSAGES,
  INQUIRY_BODY_MESSAGES,
} from './errors.ts';
import { inquiryKindOf, inquiryStatusOf } from './mappers.ts';

// 問い合わせ・カテゴリ・ファイルのIDは26文字のULIDで、一致しない値はユースケースが見つからない・添付できないとして扱う。ここでは処理量だけを抑える
const ID_INPUT_MAX_LENGTH = 64;

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

// カーソルの形式の誤りはストアが位置の指定のエラーにする。ここでは処理量だけを抑える
const after = z
  .string()
  .max(INQUIRY_CURSOR_MAX, invalidCursorError().message)
  .nullish()
  .transform((value) => value ?? undefined);

export const MY_INQUIRIES_ARGS = z.object({ after });

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

// 理由の未入力が許されるかは操作種別で決まるため、監査ログの記録の準備が判定する。ここでは上限だけを確かめる
const reason = inputRuleOf((value) =>
  checkAuditReason(value) === undefined
    ? undefined
    : AUDIT_REASON_TOO_LONG_MESSAGE,
)
  .nullish()
  .transform((value) => value ?? undefined);

const status = z
  .enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED'])
  .transform(inquiryStatusOf);

const filterDate = z
  .number()
  .nullish()
  .transform((value) => (value == null ? undefined : new Date(value)));

export const ADMIN_INQUIRIES_ARGS = z.object({
  filter: z
    .object({
      status: status.nullish(),
      kind: z.enum(['MEMBER', 'GUEST']).transform(inquiryKindOf).nullish(),
      categoryId: categoryId.nullish(),
      receivedFrom: filterDate,
      receivedBefore: filterDate,
    })
    .nullish()
    .transform((value): AdminInquiryFilter => ({
      ...(value?.status != null && { status: value.status }),
      ...(value?.kind != null && { kind: value.kind }),
      ...(value?.categoryId != null && { categoryId: value.categoryId }),
      ...(value?.receivedFrom !== undefined && {
        receivedFrom: value.receivedFrom,
      }),
      ...(value?.receivedBefore !== undefined && {
        receivedBefore: value.receivedBefore,
      }),
    })),
  after,
});

export const ADMIN_INQUIRY_ARGS = z.object({ id: inquiryId });

// 返信の本文の規則は、追加メッセージと共有するユースケースが検証する
export const REPLY_TO_INQUIRY_ARGS = z.object({
  inquiryId,
  body: z.string(),
  reason,
});

export const CHANGE_INQUIRY_STATUS_ARGS = z.object({
  inquiryId,
  status,
  reason,
});

const inquiryCategoryId = z
  .string()
  .max(ID_INPUT_MAX_LENGTH, INQUIRY_ERRORS.inquiry_category_not_found.message);

// カテゴリ名の規則と前後の空白の除去は、名前の重複の判定と同じ値で行うためユースケースが行う
export const CREATE_INQUIRY_CATEGORY_ARGS = z.object({
  name: z.string(),
  reason,
});

export const RENAME_INQUIRY_CATEGORY_ARGS = z.object({
  id: inquiryCategoryId,
  name: z.string(),
  reason,
});

export const DELETE_INQUIRY_CATEGORY_ARGS = z.object({
  id: inquiryCategoryId,
  reason,
});
