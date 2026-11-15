import { checkAdminTitle } from '../../../common-lib/admin/admin-input-rules.ts';
import {
  ADMIN_ROLES,
  type AdminRole,
} from '../../../common-lib/admin/admin-roles.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import { REASON_SCHEMAS } from '../../../lib/components/admin/reason-schema.ts';
import { z } from '../../../lib/utilities/validation/zod.ts';
import {
  EMAIL_INPUT_SCHEMA,
  NICKNAME_INPUT_SCHEMA,
} from '../auth/auth-form-schemas.ts';
import {
  ADMIN_TITLE_TOO_LONG_MESSAGE,
  NEW_ROLE_REQUIRED_MESSAGE,
} from './admin-accounts-messages.ts';

export const INVITE_ADMIN_FORM_SCHEMA = z.object({
  email: EMAIL_INPUT_SCHEMA,
  reason: REASON_SCHEMAS.optional,
});

export type InviteAdminFormInput = z.input<typeof INVITE_ADMIN_FORM_SCHEMA>;

const isAdminRole = (value: string): value is AdminRole =>
  (ADMIN_ROLES as readonly string[]).includes(value);

// 未選択は空文字で持ち、選んだときだけロールの値として送る
const roleRule = z
  .string()
  .refine(isAdminRole, { message: NEW_ROLE_REQUIRED_MESSAGE });

export const CHANGE_ROLE_FORM_SCHEMA = z.object({
  role: roleRule,
  reason: REASON_SCHEMAS.optional,
});

export type ChangeRoleFormInput = z.input<typeof CHANGE_ROLE_FORM_SCHEMA>;

// 判定と送る値を食い違わせないよう、入力規則と同じ空白の集合で前後を除き、空なら未設定にする
const titleRule = z
  .string()
  .superRefine((value, context) => {
    if (checkAdminTitle(value) !== undefined) {
      context.addIssue({
        code: 'custom',
        message: ADMIN_TITLE_TOO_LONG_MESSAGE,
      });
    }
  })
  .transform((value) => {
    const trimmed = trimWhiteSpace(value);
    return trimmed === '' ? null : trimmed;
  });

// 対象の管理者の識別子は入力欄を描かないため含めず、送信の時に足す。画像はnullで取り除く
export const ADMIN_PROFILE_FORM_SCHEMA = z.object({
  nickname: NICKNAME_INPUT_SCHEMA,
  title: titleRule,
  avatarFileId: z.string().nullable(),
});

export type AdminProfileFormInput = z.input<typeof ADMIN_PROFILE_FORM_SCHEMA>;
