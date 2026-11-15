import { AppError } from '../../../lib/core/errors/app-error.ts';
import type { SecondFactorInput } from '../../domain/auth/second-factor.ts';
import {
  AUTH_ERRORS,
  CURRENT_PASSWORD_INCORRECT_MESSAGE,
  REAUTHENTICATION_FAILED_CODE,
} from './auth-errors.ts';

export interface ReAuthenticationInput {
  readonly currentPassword: string;
  readonly secondFactor: SecondFactorInput | undefined;
}

// 詳細の欄は本人確認の入力の中の相対の経路で示す。操作ごとに本人確認の入力の置き場所が異なるため、リゾルバが入力の形に合わせて前に経路を足す
const CURRENT_PASSWORD_FIELD = 'currentPassword';

const SECOND_FACTOR_FIELD = 'secondFactor';

const SECOND_FACTOR_FIELDS: Readonly<
  Record<SecondFactorInput['kind'], string>
> = Object.freeze({
  totp: 'secondFactor.totpCode',
  recovery: 'secondFactor.recoveryCode',
});

const SECOND_FACTOR_INCORRECT_MESSAGE =
  AUTH_ERRORS.invalid_second_factor.message;

const reAuthenticationFailedError = (
  field: string,
  code: 'incorrect' | 'required',
  message: string,
): AppError =>
  new AppError({
    kind: 'unprocessable',
    code: REAUTHENTICATION_FAILED_CODE,
    message,
    details: [{ field, code, message }],
  });

export const currentPasswordIncorrectError = (): AppError =>
  reAuthenticationFailedError(
    CURRENT_PASSWORD_FIELD,
    'incorrect',
    CURRENT_PASSWORD_INCORRECT_MESSAGE,
  );

export const secondFactorRequiredError = (): AppError =>
  reAuthenticationFailedError(
    SECOND_FACTOR_FIELD,
    'required',
    SECOND_FACTOR_INCORRECT_MESSAGE,
  );

export const secondFactorIncorrectError = (
  kind: SecondFactorInput['kind'],
): AppError =>
  reAuthenticationFailedError(
    SECOND_FACTOR_FIELDS[kind],
    'incorrect',
    SECOND_FACTOR_INCORRECT_MESSAGE,
  );
