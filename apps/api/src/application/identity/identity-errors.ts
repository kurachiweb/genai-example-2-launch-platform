import {
  AppError,
  type AppErrorKind,
} from '../../../lib/core/errors/app-error.ts';
import {
  PASSWORD_MAX_CODE_POINTS,
  PASSWORD_MIN_CODE_POINTS,
} from '../../../common-lib/identity/account-input-rules.ts';

interface IdentityErrorDefinition {
  readonly kind: AppErrorKind;
  readonly message: string;
}

// 利用者に見せる文言は文言規則のエラーメッセージと同じにする
export const IDENTITY_ERRORS = Object.freeze({
  registration_email_unavailable: {
    kind: 'conflict',
    message: 'このメールアドレスは登録できません。',
  },
  invalid_credentials: {
    kind: 'unauthenticated',
    message: 'メールアドレスまたはパスワードが正しくありません。',
  },
  account_unavailable: {
    kind: 'forbidden',
    message:
      'このアカウントは現在ご利用いただけません。詳しくはお問い合わせください。',
  },
  invalid_second_factor: {
    kind: 'unauthenticated',
    message: '認証コードが正しくありません。',
  },
  login_challenge_expired: {
    kind: 'unauthenticated',
    message: '認証の有効期限が切れました。もう一度ログインしてください。',
  },
  invalid_link: {
    kind: 'unprocessable',
    message: 'このリンクは無効か、有効期限が切れています。',
  },
  email_not_verified: {
    kind: 'forbidden',
    message:
      'この操作にはメールアドレスの確認が必要です。確認メールをご確認ください。',
  },
  totp_already_enabled: {
    kind: 'conflict',
    message: '多要素認証は既に有効です。',
  },
  totp_not_enabled: {
    kind: 'conflict',
    message: '多要素認証は有効になっていません。',
  },
  totp_setup_expired: {
    kind: 'unprocessable',
    message: '設定の有効期限が切れました。最初からやり直してください。',
  },
  account_state_conflict: {
    kind: 'conflict',
    message: '処理が重なりました。時間をおいて再度お試しください。',
  },
  unauthenticated: {
    kind: 'unauthenticated',
    message: 'ログインが必要です。',
  },
  not_found: {
    kind: 'not_found',
    message: '対象が見つかりません。',
  },
  forbidden: {
    kind: 'forbidden',
    message: 'この操作はできません。',
  },
} satisfies Readonly<Record<string, IdentityErrorDefinition>>);

export type IdentityErrorCode = keyof typeof IDENTITY_ERRORS;

export const LOGIN_THROTTLED_MESSAGE =
  'ログイン試行が続いたため、しばらく待ってから再度お試しください。';

// 詳細の欄ごとに文言が異なるため、IDENTITY_ERRORSに含めず本人確認が詳細付きで組み立てる
export const REAUTHENTICATION_FAILED_CODE = 'reauthentication_failed';

export const CURRENT_PASSWORD_INCORRECT_MESSAGE =
  '現在のパスワードが正しくありません。';

export const PASSWORD_LENGTH_MESSAGE = `パスワードは${String(PASSWORD_MIN_CODE_POINTS)}文字以上${String(PASSWORD_MAX_CODE_POINTS)}文字以内で入力してください。`;

export const PWNED_PASSWORD_MESSAGE =
  'このパスワードは過去に漏洩したことがあります。別のパスワードを設定してください。';

export const PASSWORD_MATCHES_IDENTITY_MESSAGE =
  'ハンドル・ニックネーム・メールアドレス(@より前の部分を含む)と同じパスワードは使えません。';

export const identityError = (code: IdentityErrorCode): AppError => {
  const { kind, message } = IDENTITY_ERRORS[code];
  return new AppError({ kind, code, message });
};

export const loginThrottledError = (retryAfterSeconds: number): AppError =>
  new AppError({
    kind: 'rate_limited',
    code: 'login_throttled',
    message: LOGIN_THROTTLED_MESSAGE,
    retryAfterSeconds,
  });
