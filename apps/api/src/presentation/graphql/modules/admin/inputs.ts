import { z } from 'zod';

import { checkAdminNickname } from '../../../../../common-lib/admin/admin-input-rules.ts';
import { trimWhiteSpace } from '../../../../../common-lib/text/white-space.ts';
import {
  ADMIN_NICKNAME_MESSAGES,
  adminInvitationLinkError,
} from '../../../../application/admin/admin-errors.ts';
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
