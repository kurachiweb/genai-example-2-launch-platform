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
