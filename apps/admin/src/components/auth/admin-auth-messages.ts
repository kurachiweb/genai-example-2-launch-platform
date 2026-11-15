import { ADMIN_NICKNAME_MAX } from '../../../common-lib/admin/admin-input-rules.ts';
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

export const INVITATION_PAGE_TITLE = '招待の受け入れ';

export const INVITATION_PROFILE_FORM_LABEL = 'ニックネームとパスワードの設定';

export const INVITATION_PROFILE_DESCRIPTION =
  '管理画面で使うニックネームとパスワードを設定してください。続けて、ログインの時に求める多要素認証を設定します。';

export const NICKNAME_LABEL = 'ニックネーム';

export const NICKNAME_DESCRIPTION = `${String(ADMIN_NICKNAME_MAX)}文字以内で設定してください。`;

export const INVITATION_PROFILE_SUBMIT_LABEL = '多要素認証の設定へ進む';

export const TOTP_SETUP_HEADING = '多要素認証の設定';

export const TOTP_SETUP_DESCRIPTION =
  '認証アプリでQRコードを読み取り、表示された6桁の認証コードを入力してください。';

export const TOTP_MANUAL_ENTRY_LABEL =
  'QRコードを読み取れない場合は、次の文字列を認証アプリに入力してください。';

export const TOTP_SETUP_EXPIRES_PREFIX = 'この設定は';

export const TOTP_SETUP_EXPIRES_SUFFIX =
  'まで有効です。過ぎた場合は、最初からやり直してください。';

export const INVITATION_COMPLETE_SUBMIT_LABEL = '設定を完了する';

export const INVITATION_COMPLETED_MESSAGE =
  '管理者アカウントの設定が完了しました。';

export const RECOVERY_CODES_SHOWN_ONCE_MESSAGE =
  '次のリカバリコードは、この画面でだけ表示されます。認証アプリを使えない時に、認証コードの代わりに入力します。';

export const PROCEED_TO_DASHBOARD_LABEL = 'ダッシュボードへ進む';

// APIサーバーの招待のリンクの無効の文言(無効の文言に続けて再送の依頼を添える)と揃える
export const INVITATION_RESEND_REQUEST_MESSAGE =
  '招待した管理者に再送を依頼してください。';

export const EMAIL_CHANGE_PAGE_TITLE = 'メールアドレスの変更';

export const EMAIL_CHANGE_DESCRIPTION =
  'ボタンを押すと、メールアドレスの変更が完了します。ほかの端末ではログアウトします。';

export const EMAIL_CHANGE_ACTION_LABEL = 'メールアドレスの変更を確定する';

export const EMAIL_CHANGED_MESSAGE = 'メールアドレスを変更しました。';

export const LOGIN_WITH_NEW_EMAIL_MESSAGE =
  '新しいメールアドレスでログインしてください。';

export const DASHBOARD_LINK_LABEL = 'ダッシュボードへ';

export const MY_ACCOUNT_LABEL = '自分のアカウント';

export const RETRY_FROM_MY_ACCOUNT_SUFFIX =
  'から、もう一度変更を行ってください。';
