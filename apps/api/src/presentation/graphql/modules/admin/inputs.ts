import { z } from 'zod';

import {
  checkAdminNickname,
  checkAdminTitle,
  checkAuditReason,
} from '../../../../../common-lib/admin/admin-input-rules.ts';
import type { AdminRole } from '../../../../../common-lib/admin/admin-roles.ts';
import { trimWhiteSpace } from '../../../../../common-lib/text/white-space.ts';
import { invalidCursorError } from '../../../../../lib/core/errors/invalid-cursor.ts';
import {
  ADMIN_ERRORS,
  ADMIN_NICKNAME_MESSAGES,
  ADMIN_TITLE_MESSAGES,
  adminInvitationLinkError,
} from '../../../../application/admin/admin-errors.ts';
import type { AuditLogFilter } from '../../../../application/admin/audit-log-reader.ts';
import { AUDIT_REASON_TOO_LONG_MESSAGE } from '../../../../application/admin/audit-log-recorder.ts';
import {
  currentPassword,
  email,
  inputRuleOf,
  linkToken,
  linkTokenOf,
  loginChallenge,
  newPassword,
  secondFactor,
  totpCode,
} from '../../auth-inputs.ts';
import type { AdminRoleValue } from './resolver-support.ts';

// 招待された運営者は自分でリンクを取り直せないため、検証の失敗でも再送の依頼を案内する
const invitationLinkToken = linkTokenOf(adminInvitationLinkError().message);

// 判定と保存値を食い違わせないよう、入力規則と同じ空白の集合で前後を除く
const nickname = inputRuleOf((value) => {
  const violation = checkAdminNickname(value);
  return violation === undefined
    ? undefined
    : ADMIN_NICKNAME_MESSAGES[violation];
}).transform(trimWhiteSpace);

export const ADMIN_LOGIN_ARGS = z.object({ email, password: currentPassword });

export const COMPLETE_ADMIN_SECOND_FACTOR_LOGIN_ARGS = z.object({
  challenge: loginChallenge,
  secondFactor,
});

export const REQUEST_ADMIN_PASSWORD_RESET_ARGS = z.object({ email });

export const RESET_ADMIN_PASSWORD_ARGS = z.object({
  token: linkToken,
  newPassword,
});

export const START_ADMIN_INVITATION_ARGS = z.object({
  token: invitationLinkToken,
  nickname,
  password: newPassword,
});

export const COMPLETE_ADMIN_INVITATION_ARGS = z.object({
  token: invitationLinkToken,
  totpCode,
});

export const CONFIRM_ADMIN_EMAIL_CHANGE_ARGS = z.object({ token: linkToken });

// 管理者・ファイルのIDは26文字のULIDで、一致しない値はユースケースが見つからない・紐付けられないとして扱う。ここでは処理量だけを抑える
const ID_INPUT_MAX_LENGTH = 64;

const adminId = z
  .string()
  .max(ID_INPUT_MAX_LENGTH, ADMIN_ERRORS.not_found.message);

const avatarFileId = z
  .string()
  .max(ID_INPUT_MAX_LENGTH, ADMIN_ERRORS.invalid_upload.message)
  .nullish()
  .transform((value) => value ?? undefined);

// 理由の未入力が許されるかは操作種別で決まるため、監査ログの記録の準備が判定する。ここでは上限だけを確かめる
const reason = inputRuleOf((value) =>
  checkAuditReason(value) === undefined
    ? undefined
    : AUDIT_REASON_TOO_LONG_MESSAGE,
)
  .nullish()
  .transform((value) => value ?? undefined);

const optionalTitle = inputRuleOf((value) => {
  const violation = checkAdminTitle(value);
  return violation === undefined ? undefined : ADMIN_TITLE_MESSAGES[violation];
})
  .nullish()
  .transform((value) => value ?? undefined);

const reAuthentication = z.object({ currentPassword, secondFactor });

const ROLE_OF_VALUE: Readonly<Record<AdminRoleValue, AdminRole>> =
  Object.freeze({
    VIEWER: 'viewer',
    MODERATOR: 'moderator',
    SUPER_ADMIN: 'super_admin',
  });

export const INVITE_ADMIN_ARGS = z.object({ email, reason });

export const RESEND_ADMIN_INVITATION_ARGS = z.object({ id: adminId, reason });

export const DELETE_ADMIN_ARGS = z.object({ id: adminId, reason });

export const CHANGE_ADMIN_ROLE_ARGS = z.object({
  id: adminId,
  role: z
    .enum(['VIEWER', 'MODERATOR', 'SUPER_ADMIN'])
    .transform((value) => ROLE_OF_VALUE[value]),
  reason,
});

export const UPDATE_ADMIN_PROFILE_ARGS = z.object({
  id: adminId,
  nickname,
  title: optionalTitle,
  avatarFileId,
});

export const REQUEST_ADMIN_EMAIL_CHANGE_ARGS = z.object({
  newEmail: email,
  reAuthentication,
});

export const CHANGE_ADMIN_PASSWORD_ARGS = z.object({
  newPassword,
  reAuthentication,
});

export const RE_AUTHENTICATION_ARGS = z.object({ reAuthentication });

export const COMPLETE_ADMIN_TOTP_RESET_ARGS = z.object({ totpCode });

// 条件の値は保存された値との一致だけに使うため、保存され得る長さを超える値を拒み、空の文字列は未指定とする
const AUDIT_FILTER_TEXT_MAX_LENGTH = 64;

const AUDIT_FILTER_TOO_LONG_MESSAGE = `検索条件は${String(AUDIT_FILTER_TEXT_MAX_LENGTH)}文字以内で入力してください。`;

const filterText = z
  .string()
  .max(AUDIT_FILTER_TEXT_MAX_LENGTH, AUDIT_FILTER_TOO_LONG_MESSAGE)
  .nullish()
  .transform((value) => (value == null || value === '' ? undefined : value));

const filterDate = z
  .number()
  .nullish()
  .transform((value) => (value == null ? undefined : new Date(value)));

const AUDIT_LOG_CURSOR_MAX_LENGTH = 256;

export const AUDIT_LOGS_ARGS = z.object({
  filter: z
    .object({
      operatorId: filterText,
      action: filterText,
      targetId: filterText,
      occurredFrom: filterDate,
      occurredBefore: filterDate,
    })
    .nullish()
    .transform((value): AuditLogFilter => ({
      ...(value?.operatorId !== undefined && {
        operatorAdminId: value.operatorId,
      }),
      ...(value?.action !== undefined && { action: value.action }),
      ...(value?.targetId !== undefined && { targetId: value.targetId }),
      ...(value?.occurredFrom !== undefined && {
        occurredFrom: value.occurredFrom,
      }),
      ...(value?.occurredBefore !== undefined && {
        occurredBefore: value.occurredBefore,
      }),
    })),
  after: z
    .string()
    .max(AUDIT_LOG_CURSOR_MAX_LENGTH, invalidCursorError().message)
    .nullish()
    .transform((value) => value ?? undefined),
});
