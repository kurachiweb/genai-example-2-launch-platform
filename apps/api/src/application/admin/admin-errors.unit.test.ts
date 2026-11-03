import { describe, expect, test } from 'bun:test';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import {
  AUTH_ERRORS,
  PASSWORD_LENGTH_MESSAGE,
  PWNED_PASSWORD_MESSAGE,
} from '../auth/auth-errors.ts';
import {
  ADMIN_ERRORS,
  adminError,
  adminPasswordRejectedError,
} from './admin-errors.ts';

const ADMIN_PASSWORD_MATCHES_IDENTITY_MESSAGE =
  'ニックネーム・メールアドレス(@より前の部分を含む)と同じパスワードは使えません。';

describe('adminError', () => {
  test.each([
    [
      'admin_email_in_use',
      'conflict',
      'このメールアドレスは既に管理者として登録されています。',
    ],
    [
      'last_super_admin',
      'conflict',
      '最上位管理者が1人だけのため、この操作はできません。',
    ],
    [
      'self_deletion_forbidden',
      'forbidden',
      '自分自身のアカウントは削除できません。',
    ],
    [
      'admin_state_conflict',
      'conflict',
      '処理が重なりました。時間をおいて再度お試しください。',
    ],
    [
      'invalid_credentials',
      'unauthenticated',
      'メールアドレスまたはパスワードが正しくありません。',
    ],
  ] as const)(
    '%sは種類%sと定めた文言のAppErrorになる',
    (code, kind, message) => {
      const error = adminError(code);

      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code, kind, message });
      expect(error.details).toBeUndefined();
    },
  );

  test('共有の全コードを同じ定義で含む', () => {
    for (const [code, definition] of Object.entries(AUTH_ERRORS)) {
      expect(ADMIN_ERRORS[code as keyof typeof AUTH_ERRORS]).toBe(definition);
    }
  });

  test('共有の8種類と管理者に固有の4種類だけを持つ', () => {
    expect(Object.keys(ADMIN_ERRORS).toSorted()).toEqual(
      [
        ...Object.keys(AUTH_ERRORS),
        'admin_email_in_use',
        'last_super_admin',
        'self_deletion_forbidden',
        'admin_state_conflict',
      ].toSorted(),
    );
    expect(Object.isFrozen(ADMIN_ERRORS)).toBe(true);
  });
});

describe('adminPasswordRejectedError', () => {
  test('識別子との一致はハンドルを含まない管理者用の文言で拒否する', () => {
    const error = adminPasswordRejectedError('matches-identity');

    expect(error).toMatchObject({
      kind: 'unprocessable',
      code: 'password_rejected',
      message: ADMIN_PASSWORD_MATCHES_IDENTITY_MESSAGE,
    });
    expect(error.details).toEqual([
      {
        field: 'password',
        code: 'matches_identity',
        message: ADMIN_PASSWORD_MATCHES_IDENTITY_MESSAGE,
      },
    ]);
  });

  test.each([
    ['pwned', 'pwned', PWNED_PASSWORD_MESSAGE],
    ['too-short', 'too_short', PASSWORD_LENGTH_MESSAGE],
    ['too-long', 'too_long', PASSWORD_LENGTH_MESSAGE],
  ] as const)(
    '違反%sは共有の文言と詳細のコード%sで拒否する',
    (violation, detailCode, message) => {
      expect(
        adminPasswordRejectedError(violation, 'newPassword').details,
      ).toEqual([{ field: 'newPassword', code: detailCode, message }]);
    },
  );
});
