import {
  AppError,
  type FieldErrorDetail,
} from '../../../../../lib/core/errors/app-error.ts';
import {
  EMAIL_MAX_LENGTH,
  NICKNAME_MAX_GRAPHEMES,
} from '../../../../../common-lib/identity/account-input-rules.ts';
import {
  PASSWORD_LENGTH_MESSAGE,
  REAUTHENTICATION_FAILED_CODE,
} from '../../../../application/auth/auth-errors.ts';
import {
  IDENTITY_ERRORS,
  identityError,
} from '../../../../application/identity/identity-errors.ts';

// 入力の検証の失敗(validation_error)の欄ごとの文言。ユースケースが投げるエラーの文言はapplication層のidentity-errors.ts・auth-errors.tsにある
export const INPUT_MESSAGES = Object.freeze({
  nicknameRequired: 'ニックネームを入力してください。',
  nicknameTooLong: `ニックネームは${String(NICKNAME_MAX_GRAPHEMES)}文字以内で入力してください。`,
  emailRequired: 'メールアドレスを入力してください。',
  emailTooLong: `メールアドレスは${String(EMAIL_MAX_LENGTH)}文字以内で入力してください。`,
  emailFormat: 'メールアドレスの形式が正しくありません。',
  passwordRequired: 'パスワードを入力してください。',
  passwordLength: PASSWORD_LENGTH_MESSAGE,
  termsNotAgreed: '利用規約とプライバシーポリシーに同意してください。',
  secondFactorChoice:
    '認証コードかリカバリコードのどちらか一方を入力してください。',
  secondFactorIncorrect: IDENTITY_ERRORS.invalid_second_factor.message,
  invalidLink: IDENTITY_ERRORS.invalid_link.message,
  loginChallengeExpired: IDENTITY_ERRORS.login_challenge_expired.message,
  sessionNotFound: IDENTITY_ERRORS.not_found.message,
});

// GraphQLの引数の名前。検証の詳細の欄と同じく、ユースケースが返す詳細の欄もこの下の経路で示す
export const INPUT_ARGUMENT = 'input';

export const callerForbiddenError = (): AppError => identityError('forbidden');

function withPrefixedFields(error: AppError, prefix: string): AppError {
  const details = error.details?.map((detail): FieldErrorDetail => ({
    ...detail,
    field: `${prefix}.${detail.field}`,
  }));
  return new AppError({
    kind: error.kind,
    code: error.code,
    message: error.message,
    ...(details !== undefined && { details }),
    ...(error.retryAfterSeconds !== undefined && {
      retryAfterSeconds: error.retryAfterSeconds,
    }),
  });
}

// 本人確認の入力を操作の入力の中に持つ操作での、本人確認の入力の経路
export const NESTED_RE_AUTHENTICATION_PATH = `${INPUT_ARGUMENT}.reAuthentication`;

type PathPrefix = string | ((error: AppError) => string);

// ユースケースは詳細の欄を自身の入力からの相対の経路で返すため、GraphQLの入力の形のとおりの経路に直す
export async function withInputPath<T>(
  prefix: PathPrefix,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error: unknown) {
    if (error instanceof AppError && error.details !== undefined) {
      throw withPrefixedFields(
        error,
        typeof prefix === 'string' ? prefix : prefix(error),
      );
    }
    throw error;
  }
}

// 本人確認の失敗は本人確認の入力からの相対、パスワードの方針の違反などは操作の入力からの相対の経路で返る
export function withNestedReAuthenticationPath<T>(
  run: () => Promise<T>,
): Promise<T> {
  return withInputPath(
    (error) =>
      error.code === REAUTHENTICATION_FAILED_CODE
        ? NESTED_RE_AUTHENTICATION_PATH
        : INPUT_ARGUMENT,
    run,
  );
}
