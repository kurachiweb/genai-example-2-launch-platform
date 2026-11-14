import {
  AppError,
  type AppErrorKind,
} from '../../../lib/core/errors/app-error.ts';
import {
  PASSWORD_MAX_CODE_POINTS,
  PASSWORD_MIN_CODE_POINTS,
} from '../../../common-lib/identity/account-input-rules.ts';

export interface AuthErrorDefinition {
  readonly kind: AppErrorKind;
  readonly message: string;
}

// 主体ごとのエラーの定義はこれを展開して固有のコードだけを足し、主体の間でコードと文言を食い違わせない
export const AUTH_ERRORS = Object.freeze({
  invalid_credentials: {
    kind: 'unauthenticated',
    message: 'メールアドレスまたはパスワードが正しくありません。',
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
  totp_setup_expired: {
    kind: 'unprocessable',
    message: '設定の有効期限が切れました。最初からやり直してください。',
  },
  unauthenticated: {
    kind: 'unauthenticated',
    message: 'ログインが必要です。',
  },
  forbidden: {
    kind: 'forbidden',
    message: 'この操作はできません。',
  },
  not_found: {
    kind: 'not_found',
    message: '対象が見つかりません。',
  },
} satisfies Readonly<Record<string, AuthErrorDefinition>>);

export type AuthErrorCode = keyof typeof AUTH_ERRORS;

export const LOGIN_THROTTLED_MESSAGE =
  'ログイン試行が続いたため、しばらく待ってから再度お試しください。';

// 詳細の欄ごとに文言が異なるため、AUTH_ERRORSに含めず本人確認が詳細付きで組み立てる
export const REAUTHENTICATION_FAILED_CODE = 'reauthentication_failed';

export const CURRENT_PASSWORD_INCORRECT_MESSAGE =
  '現在のパスワードが正しくありません。';

export const PASSWORD_LENGTH_MESSAGE = `パスワードは${String(PASSWORD_MIN_CODE_POINTS)}文字以上${String(PASSWORD_MAX_CODE_POINTS)}文字以内で入力してください。`;

export const PWNED_PASSWORD_MESSAGE =
  'このパスワードは過去に漏洩したことがあります。別のパスワードを設定してください。';

export const authError = (code: AuthErrorCode): AppError => {
  const { kind, message } = AUTH_ERRORS[code];
  return new AppError({ kind, code, message });
};

export const loginThrottledError = (retryAfterSeconds: number): AppError =>
  new AppError({
    kind: 'rate_limited',
    code: 'login_throttled',
    message: LOGIN_THROTTLED_MESSAGE,
    retryAfterSeconds,
  });
