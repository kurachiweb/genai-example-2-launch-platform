import {
  createPasswordRejectedError,
  type PasswordRejectedError,
} from '../auth/password-rejection.ts';
import { PASSWORD_MATCHES_IDENTITY_MESSAGE } from './identity-errors.ts';

// 登録・パスワードリセット・パスワード変更で、新しいパスワードが方針に反したときに投げる
export const passwordRejectedError: PasswordRejectedError =
  createPasswordRejectedError(PASSWORD_MATCHES_IDENTITY_MESSAGE);
