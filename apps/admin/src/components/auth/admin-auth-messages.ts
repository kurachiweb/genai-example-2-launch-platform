import {
  PASSWORD_MAX_CODE_POINTS,
  PASSWORD_MIN_CODE_POINTS,
} from '../../../common-lib/identity/account-input-rules.ts';

export const LOGIN_PAGE_TITLE = 'ログイン';

export const SECOND_FACTOR_FORM_LABEL = '認証コードの入力';

export const EMAIL_LABEL = 'メールアドレス';

export const PASSWORD_LABEL = 'パスワード';

export const REQUIRED_SUFFIX = '(必須)';

export const LOGIN_SUBMIT_LABEL = 'ログインする';

export const FORGOT_PASSWORD_PROMPT = 'パスワードをお忘れの場合は、';

export const PASSWORD_RESET_LABEL = 'パスワードの再設定';

export const PASSWORD_RESET_SUFFIX = 'を行ってください。';

export const TOTP_CODE_LABEL = '認証コード';

export const TOTP_CODE_DESCRIPTION =
  '認証アプリに表示されている6桁の認証コードを入力してください。';

export const RECOVERY_CODE_LABEL = 'リカバリコード';

export const RECOVERY_CODE_DESCRIPTION =
  '保管しているリカバリコードを1つ入力してください。各コードは1回だけ使えます。';

export const USE_RECOVERY_CODE_LABEL = 'リカバリコードを使う';

export const USE_TOTP_CODE_LABEL = '認証コードを使う';

export const LOGIN_PAGE_LINK_LABEL = 'ログイン画面へ';

export const INVALID_LINK_MESSAGE =
  'このリンクは無効か、有効期限が切れています。';

export const PASSWORD_RESET_PAGE_TITLE = PASSWORD_RESET_LABEL;

export const PASSWORD_RESET_REQUEST_DESCRIPTION =
  '管理者として登録しているメールアドレスを入力してください。パスワードの再設定のリンクを送信します。';

export const PASSWORD_RESET_REQUEST_SUBMIT_LABEL = '再設定のリンクを送信する';

export const PASSWORD_RESET_LINK_SENT_MESSAGE =
  '入力したメールアドレスが管理者として登録されている場合は、パスワードの再設定のリンクを送信しました。リンクの有効期限は30分です。';

export const PASSWORD_RESET_CONFIRM_PAGE_TITLE = '新しいパスワードの設定';

export const NEW_PASSWORD_LABEL = '新しいパスワード';

export const NEW_PASSWORD_DESCRIPTION = `${String(PASSWORD_MIN_CODE_POINTS)}文字以上${String(PASSWORD_MAX_CODE_POINTS)}文字以内で設定してください。`;

export const PASSWORD_RESET_SUBMIT_LABEL = 'パスワードを再設定する';

export const PASSWORD_RESET_DONE_MESSAGE =
  'パスワードを再設定しました。新しいパスワードでログインしてください。';

export const RETRY_PASSWORD_RESET_SUFFIX = 'をもう一度行ってください。';
