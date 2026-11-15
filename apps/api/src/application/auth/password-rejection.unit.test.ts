import { describe, expect, test } from 'bun:test';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import {
  PASSWORD_LENGTH_MESSAGE,
  PWNED_PASSWORD_MESSAGE,
} from './auth-errors.ts';
import { createPasswordRejectedError } from './password-rejection.ts';

const MATCHES_IDENTITY_MESSAGE = '識別子と同じパスワードは使えません。';

const passwordRejectedError = createPasswordRejectedError(
  MATCHES_IDENTITY_MESSAGE,
);

describe('createPasswordRejectedError', () => {
  test.each([
    ['pwned', 'pwned', PWNED_PASSWORD_MESSAGE],
    ['matches-identity', 'matches_identity', MATCHES_IDENTITY_MESSAGE],
    ['too-short', 'too_short', PASSWORD_LENGTH_MESSAGE],
    ['too-long', 'too_long', PASSWORD_LENGTH_MESSAGE],
  ] as const)(
    '違反%sは詳細のコード%sと文言を持つ422のpassword_rejectedになる',
    (violation, detailCode, message) => {
      const error = passwordRejectedError(violation);

      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        kind: 'unprocessable',
        code: 'password_rejected',
        message,
      });
      expect(error.details).toEqual([
        { field: 'password', code: detailCode, message },
      ]);
    },
  );

  test('欄を渡すと詳細の欄をその名前にする', () => {
    expect(passwordRejectedError('pwned', 'newPassword').details).toEqual([
      {
        field: 'newPassword',
        code: 'pwned',
        message: PWNED_PASSWORD_MESSAGE,
      },
    ]);
  });

  test('識別子との一致の文言だけを主体ごとに差し替える', () => {
    const other = createPasswordRejectedError('別の主体の文言');

    expect(other('matches-identity').message).toBe('別の主体の文言');
    expect(other('too-short').message).toBe(PASSWORD_LENGTH_MESSAGE);
  });
});
