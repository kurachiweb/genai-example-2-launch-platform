import { describe, expect, test } from 'bun:test';

import {
  LOGIN_FORM_SCHEMA,
  NEW_PASSWORD_FORM_SCHEMA,
  PASSWORD_RESET_REQUEST_FORM_SCHEMA,
  RECOVERY_CODE_FORM_SCHEMA,
  TOTP_CODE_FORM_SCHEMA,
} from './auth-form-schemas.ts';

const VALID_PASSWORD = ['console', 'gate', 'keeper'].join('-');
const SHORT_PASSWORD = ['sh', 'ort'].join('');

const EMAIL = 'operator@admin.example';

const messagesOf = (result: {
  readonly success: boolean;
  readonly error?: { readonly issues: readonly { message: string }[] };
}): readonly string[] =>
  result.error?.issues.map(({ message }) => message) ?? [];

describe('LOGIN_FORM_SCHEMA', () => {
  test('メールアドレスの前後の空白を除き、パスワードはそのまま出力する', () => {
    expect(
      LOGIN_FORM_SCHEMA.parse({
        email: ` ${EMAIL}\n`,
        password: ` ${VALID_PASSWORD} `,
      }),
    ).toEqual({ email: EMAIL, password: ` ${VALID_PASSWORD} ` });
  });

  test.each([
    [
      '空白だけのメールアドレス',
      { email: '　 ', password: VALID_PASSWORD },
      'メールアドレスを入力してください。',
    ],
    [
      '255文字のメールアドレス',
      { email: `${'a'.repeat(243)}@admin.example`, password: VALID_PASSWORD },
      'メールアドレスは254文字以内で入力してください。',
    ],
    [
      '形式の正しくないメールアドレス',
      { email: 'operator', password: VALID_PASSWORD },
      'メールアドレスの形式が正しくありません。',
    ],
    [
      '空のパスワード',
      { email: EMAIL, password: '' },
      'パスワードを入力してください。',
    ],
    [
      '129文字のパスワード',
      { email: EMAIL, password: 'a'.repeat(129) },
      'パスワードは8文字以上128文字以内で入力してください。',
    ],
  ])('%sを、APIと同じ文言で拒否する', (_label, input, message) => {
    expect(messagesOf(LOGIN_FORM_SCHEMA.safeParse(input))).toStrictEqual([
      message,
    ]);
  });

  test('照合では新しいパスワードの下限を問わない', () => {
    expect(
      LOGIN_FORM_SCHEMA.safeParse({ email: EMAIL, password: SHORT_PASSWORD })
        .success,
    ).toBe(true);
  });
});

describe('PASSWORD_RESET_REQUEST_FORM_SCHEMA', () => {
  test('メールアドレスの前後の空白を除いて出力する', () => {
    expect(
      PASSWORD_RESET_REQUEST_FORM_SCHEMA.parse({ email: `\u3000${EMAIL} ` }),
    ).toEqual({ email: EMAIL });
  });

  test('空のメールアドレスを拒否する', () => {
    expect(
      messagesOf(PASSWORD_RESET_REQUEST_FORM_SCHEMA.safeParse({ email: '' })),
    ).toStrictEqual(['メールアドレスを入力してください。']);
  });
});

describe('NEW_PASSWORD_FORM_SCHEMA', () => {
  test('8文字以上128文字以内のパスワードをそのまま出力する', () => {
    expect(
      NEW_PASSWORD_FORM_SCHEMA.parse({ newPassword: VALID_PASSWORD }),
    ).toEqual({ newPassword: VALID_PASSWORD });
  });

  test.each([
    ['7文字', 'a'.repeat(7)],
    ['129文字', 'a'.repeat(129)],
  ])('%sのパスワードを、APIと同じ文言で拒否する', (_label, newPassword) => {
    expect(
      messagesOf(NEW_PASSWORD_FORM_SCHEMA.safeParse({ newPassword })),
    ).toStrictEqual(['パスワードは8文字以上128文字以内で入力してください。']);
  });
});

describe('第2要素のスキーマ', () => {
  test('認証コードのスキーマは、認証コードだけを出力する', () => {
    expect(
      TOTP_CODE_FORM_SCHEMA.parse({
        secondFactor: { totpCode: '123456', recoveryCode: 'abcd-efgh' },
      }),
    ).toEqual({ secondFactor: { totpCode: '123456' } });
  });

  test('リカバリコードのスキーマは、リカバリコードだけを出力する', () => {
    expect(
      RECOVERY_CODE_FORM_SCHEMA.parse({
        secondFactor: { totpCode: '123456', recoveryCode: 'abcd-efgh' },
      }),
    ).toEqual({ secondFactor: { recoveryCode: 'abcd-efgh' } });
  });

  test.each([
    [
      '空白だけの認証コード',
      TOTP_CODE_FORM_SCHEMA,
      { totpCode: ' ' },
      '認証コードを入力してください。',
    ],
    [
      '空のリカバリコード',
      RECOVERY_CODE_FORM_SCHEMA,
      { recoveryCode: '' },
      'リカバリコードを入力してください。',
    ],
    [
      '65文字の認証コード',
      TOTP_CODE_FORM_SCHEMA,
      { totpCode: '1'.repeat(65) },
      '認証コードが正しくありません。',
    ],
    [
      '65文字のリカバリコード',
      RECOVERY_CODE_FORM_SCHEMA,
      { recoveryCode: 'a'.repeat(65) },
      '認証コードが正しくありません。',
    ],
  ])('%sを拒否する', (_label, schema, secondFactor, message) => {
    expect(messagesOf(schema.safeParse({ secondFactor }))).toStrictEqual([
      message,
    ]);
  });
});
