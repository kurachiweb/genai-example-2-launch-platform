import { describe, expect, test } from 'bun:test';

import {
  EMAIL_CHANGE_FORM_SCHEMAS,
  PASSWORD_CHANGE_FORM_SCHEMAS,
  REAUTHENTICATION_FORM_SCHEMAS,
  TOTP_RESET_FORM_SCHEMA,
} from './account-form-schemas.ts';

const CURRENT = ['console', 'gate', 'keeper'].join('-');
const NEXT = ['harbor', 'lantern', 'drift'].join('-');
const SHORT = ['sh', 'ort'].join('');
const EMAIL = 'next@admin.example';

const BOTH_FACTORS = Object.freeze({
  totpCode: ' 123456 ',
  recoveryCode: 'abcd-efgh',
});

const messagesOf = (result: {
  readonly success: boolean;
  readonly error?: { readonly issues: readonly { message: string }[] };
}): readonly string[] =>
  result.error?.issues.map(({ message }) => message) ?? [];

describe('REAUTHENTICATION_FORM_SCHEMAS', () => {
  test('認証コードの間は認証コードだけを、リカバリコードの間はリカバリコードだけを出力する', () => {
    const input = {
      reAuthentication: {
        currentPassword: CURRENT,
        secondFactor: BOTH_FACTORS,
      },
    };

    expect(REAUTHENTICATION_FORM_SCHEMAS.totp.parse(input)).toEqual({
      reAuthentication: {
        currentPassword: CURRENT,
        secondFactor: { totpCode: ' 123456 ' },
      },
    });
    expect(REAUTHENTICATION_FORM_SCHEMAS.recovery.parse(input)).toEqual({
      reAuthentication: {
        currentPassword: CURRENT,
        secondFactor: { recoveryCode: 'abcd-efgh' },
      },
    });
  });

  test.each([
    [
      'totp' as const,
      { currentPassword: '', secondFactor: { totpCode: '' } },
      ['パスワードを入力してください。', '認証コードを入力してください。'],
    ],
    [
      'recovery' as const,
      { currentPassword: CURRENT, secondFactor: { recoveryCode: '　' } },
      ['リカバリコードを入力してください。'],
    ],
    [
      'totp' as const,
      { currentPassword: 'a'.repeat(129), secondFactor: { totpCode: '1' } },
      ['パスワードは8文字以上128文字以内で入力してください。'],
    ],
  ])(
    '%sの本人確認の違反を、APIと同じ文言で示す',
    (mode, reAuthentication, messages) => {
      expect(
        messagesOf(
          REAUTHENTICATION_FORM_SCHEMAS[mode].safeParse({ reAuthentication }),
        ),
      ).toEqual(messages);
    },
  );

  test('現在のパスワードは下限を問わない', () => {
    expect(
      REAUTHENTICATION_FORM_SCHEMAS.totp.safeParse({
        reAuthentication: {
          currentPassword: SHORT,
          secondFactor: { totpCode: '123456' },
        },
      }).success,
    ).toBe(true);
  });
});

describe('EMAIL_CHANGE_FORM_SCHEMAS', () => {
  test('新しいメールアドレスの前後の空白を除き、本人確認と合わせて出力する', () => {
    expect(
      EMAIL_CHANGE_FORM_SCHEMAS.totp.parse({
        newEmail: ` ${EMAIL} `,
        reAuthentication: {
          currentPassword: CURRENT,
          secondFactor: BOTH_FACTORS,
        },
      }),
    ).toEqual({
      newEmail: EMAIL,
      reAuthentication: {
        currentPassword: CURRENT,
        secondFactor: { totpCode: ' 123456 ' },
      },
    });
  });

  test('形式の正しくないメールアドレスを拒否する', () => {
    expect(
      messagesOf(
        EMAIL_CHANGE_FORM_SCHEMAS.recovery.safeParse({
          newEmail: 'next',
          reAuthentication: {
            currentPassword: CURRENT,
            secondFactor: BOTH_FACTORS,
          },
        }),
      ),
    ).toEqual(['メールアドレスの形式が正しくありません。']);
  });
});

describe('PASSWORD_CHANGE_FORM_SCHEMAS', () => {
  test('新しいパスワードはそのまま、本人確認と合わせて出力する', () => {
    expect(
      PASSWORD_CHANGE_FORM_SCHEMAS.recovery.parse({
        newPassword: NEXT,
        reAuthentication: {
          currentPassword: CURRENT,
          secondFactor: BOTH_FACTORS,
        },
      }),
    ).toEqual({
      newPassword: NEXT,
      reAuthentication: {
        currentPassword: CURRENT,
        secondFactor: { recoveryCode: 'abcd-efgh' },
      },
    });
  });

  test('8文字未満の新しいパスワードを拒否する', () => {
    expect(
      messagesOf(
        PASSWORD_CHANGE_FORM_SCHEMAS.totp.safeParse({
          newPassword: SHORT,
          reAuthentication: {
            currentPassword: CURRENT,
            secondFactor: BOTH_FACTORS,
          },
        }),
      ),
    ).toEqual(['パスワードは8文字以上128文字以内で入力してください。']);
  });
});

describe('TOTP_RESET_FORM_SCHEMA', () => {
  test('空の認証コードを拒否する', () => {
    expect(
      messagesOf(TOTP_RESET_FORM_SCHEMA.safeParse({ totpCode: ' ' })),
    ).toEqual(['認証コードを入力してください。']);
  });
});
