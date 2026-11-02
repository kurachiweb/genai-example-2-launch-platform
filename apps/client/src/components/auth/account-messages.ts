import {
  PASSWORD_MAX_CODE_POINTS,
  PASSWORD_MIN_CODE_POINTS,
} from '../../../common-lib/identity/account-input-rules.ts';

export const LOGGED_OUT_MESSAGE = 'ログアウトしました。';

export const VERIFY_EMAIL_BANNER_MESSAGE =
  'メールアドレスの確認が完了していません。評価・コメント・フォロー・Upvoteには確認が必要です。';

export const RESEND_VERIFICATION_LABEL = '確認メールを再送';

export const VERIFICATION_RESENT_MESSAGE = '確認メールを再送しました。';

export const EMAIL_ALREADY_VERIFIED_MESSAGE = 'メールアドレスは確認済みです。';

export const LOGIN_LABEL = 'ログイン';

export const REGISTER_LABEL = '登録';

export const REGISTER_PAGE_TITLE = 'ユーザー登録';

export const LOGIN_PAGE_TITLE = 'ログイン';

export const SECOND_FACTOR_FORM_LABEL = '認証コードの入力';

export const NICKNAME_LABEL = 'ニックネーム';

export const EMAIL_LABEL = 'メールアドレス';

export const PASSWORD_LABEL = 'パスワード';

export const REQUIRED_SUFFIX = '(必須)';

export const NEW_PASSWORD_DESCRIPTION = `${String(PASSWORD_MIN_CODE_POINTS)}文字以上${String(PASSWORD_MAX_CODE_POINTS)}文字以内で設定してください。`;

export const TERMS_LINK_LABEL = '利用規約';

export const PRIVACY_LINK_LABEL = 'プライバシーポリシー';

export const TERMS_AGREEMENT_CONNECTOR = 'と';

export const TERMS_AGREEMENT_STATEMENT =
  'に同意し、18歳以上であることを表明する';

export const REGISTER_SUBMIT_LABEL = '登録する';

export const LOGIN_SUBMIT_LABEL = 'ログインする';

export const HAS_ACCOUNT_PROMPT = 'アカウントをお持ちの場合は、';

export const NO_ACCOUNT_PROMPT = 'アカウントをお持ちでない場合は、';

export const FORGOT_PASSWORD_PROMPT = 'パスワードをお忘れの場合は、';

export const LINK_ACTION_SUFFIX = 'してください。';

export const PASSWORD_RESET_SUFFIX = 'を行ってください。';

export const PASSWORD_RESET_LABEL = 'パスワードの再設定';

export const TOTP_CODE_LABEL = '認証コード';

export const TOTP_CODE_DESCRIPTION =
  '認証アプリに表示されている6桁の認証コードを入力してください。';

export const RECOVERY_CODE_LABEL = 'リカバリコード';

export const RECOVERY_CODE_DESCRIPTION =
  '保管しているリカバリコードを1つ入力してください。各コードは1回だけ使えます。';

export const USE_RECOVERY_CODE_LABEL = 'リカバリコードを使う';

export const USE_TOTP_CODE_LABEL = '認証コードを使う';

export const NEW_PASSWORD_LABEL = '新しいパスワード';

export const INVALID_LINK_MESSAGE =
  'このリンクは無効か、有効期限が切れています。';

export const HOME_LINK_LABEL = 'トップページへ';

export const LOGIN_PAGE_LINK_LABEL = 'ログイン画面へ';

export const VERIFY_EMAIL_PAGE_TITLE = 'メールアドレスの確認';

export const VERIFY_EMAIL_DESCRIPTION =
  'ボタンを押すと、メールアドレスの確認が完了します。';

export const VERIFY_EMAIL_ACTION_LABEL = 'メールアドレスを確認する';

export const EMAIL_VERIFIED_MESSAGE = 'メールアドレスの確認が完了しました。';

export const RESEND_AFTER_LOGIN_PREFIX = '確認メールは、';

export const RESEND_AFTER_LOGIN_SUFFIX = 'した後に再送できます。';

export const RESEND_FROM_BANNER_GUIDE = `確認メールは、画面上部の「${RESEND_VERIFICATION_LABEL}」から再送できます。`;

export const EMAIL_CHANGE_PAGE_TITLE = 'メールアドレスの変更';

export const EMAIL_CHANGE_DESCRIPTION =
  'ボタンを押すと、メールアドレスの変更が完了します。ほかの端末ではログアウトします。';

export const EMAIL_CHANGE_ACTION_LABEL = 'メールアドレスの変更を確定する';

export const EMAIL_CHANGED_MESSAGE = 'メールアドレスを変更しました。';

export const LOGIN_WITH_NEW_EMAIL_MESSAGE =
  '新しいメールアドレスでログインしてください。';

export const PASSWORD_CHANGE_PAGE_TITLE = 'パスワードの変更';

export const PASSWORD_CHANGE_DESCRIPTION =
  'ボタンを押すと、パスワードの変更が完了します。ほかの端末ではログアウトします。';

export const PASSWORD_CHANGE_ACTION_LABEL = 'パスワードの変更を確定する';

export const PASSWORD_CHANGED_MESSAGE = 'パスワードを変更しました。';

export const LOGIN_WITH_NEW_PASSWORD_MESSAGE =
  '新しいパスワードでログインしてください。';

export const ACCOUNT_SETTINGS_LABEL = 'アカウントの設定';

export const RETRY_FROM_SETTINGS_SUFFIX =
  'から、もう一度変更を行ってください。';

export const PASSWORD_RESET_PAGE_TITLE = PASSWORD_RESET_LABEL;

export const PASSWORD_RESET_REQUEST_DESCRIPTION =
  '登録しているメールアドレスを入力してください。パスワードの再設定のリンクを送信します。';

export const PASSWORD_RESET_REQUEST_SUBMIT_LABEL = '再設定のリンクを送信する';

export const PASSWORD_RESET_LINK_SENT_MESSAGE =
  '入力したメールアドレスが登録されている場合は、パスワードの再設定のリンクを送信しました。リンクの有効期限は30分です。';

export const PASSWORD_RESET_CONFIRM_PAGE_TITLE = '新しいパスワードの設定';

export const PASSWORD_RESET_SUBMIT_LABEL = 'パスワードを再設定する';

export const PASSWORD_RESET_DONE_MESSAGE = `パスワードを再設定しました。${LOGIN_WITH_NEW_PASSWORD_MESSAGE}`;

export const RETRY_PASSWORD_RESET_SUFFIX = 'をもう一度行ってください。';
