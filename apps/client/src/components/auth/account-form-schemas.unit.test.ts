import { describe, expect, test } from 'bun:test';

import {
  EMAIL_CHANGE_FORM_SCHEMAS,
  LOGIN_FORM_SCHEMA,
  PASSWORD_CHANGE_FORM_SCHEMAS,
  PASSWORD_RESET_FORM_SCHEMA,
  PASSWORD_RESET_REQUEST_FORM_SCHEMA,
  RECOVERY_CODE_FORM_SCHEMA,
  REGISTER_FORM_SCHEMA,
  TOTP_CODE_FORM_SCHEMA,
  WITHDRAWAL_FORM_SCHEMAS,
} from './account-form-schemas.ts';

const VALID_PASSWORD = ['pitch', 'notes', 'launch'].join('-');

const VALID_REGISTRATION = Object.freeze({
  nickname: 'ピッチの作り手',
  email: 'maker@launch.example',
  password: VALID_PASSWORD,
  agreedToTerms: true,
});

const messagesOf = (result: {
  readonly success: boolean;
  readonly error?: { readonly issues: readonly { message: string }[] };
}): readonly string[] =>
  result.error?.issues.map(({ message }) => message) ?? [];

describe('REGISTER_FORM_SCHEMA', () => {
  test('ニックネームとメールアドレスの前後の空白を除いた値を出力する', () => {
    const result = REGISTER_FORM_SCHEMA.parse({
      ...VALID_REGISTRATION,
      nickname: '　ピッチの作り手 ',
      email: ' maker@launch.example\n',
    });

    expect(result).toEqual({
      ...VALID_REGISTRATION,
      nickname: 'ピッチの作り手',
      email: 'maker@launch.example',
    });
  });

  test.each([
    [
      '空白だけのニックネーム',
      { nickname: '　 ' },
      'ニックネームを入力してください。',
    ],
    [
      '26文字のニックネーム',
      { nickname: 'あ'.repeat(26) },
      'ニックネームは25文字以内で入力してください。',
    ],
    ['空のメールアドレス', { email: '' }, 'メールアドレスを入力してください。'],
    [
      '255文字のメールアドレス',
      { email: `${'a'.repeat(242)}@launch.example` },
      'メールアドレスは254文字以内で入力してください。',
    ],
    [
      '形式が正しくないメールアドレス',
      { email: 'maker@' },
      'メールアドレスの形式が正しくありません。',
    ],
    [
      '7文字のパスワード',
      { password: 'a'.repeat(7) },
      'パスワードは8文字以上128文字以内で入力してください。',
    ],
    [
      '129文字のパスワード',
      { password: 'a'.repeat(129) },
      'パスワードは8文字以上128文字以内で入力してください。',
    ],
    [
      '同意の無い入力',
      { agreedToTerms: false },
      '利用規約とプライバシーポリシーに同意してください。',
    ],
  ])('%sは文言規則の文言で拒否する', (_name, overrides, message) => {
    const result = REGISTER_FORM_SCHEMA.safeParse({
      ...VALID_REGISTRATION,
      ...overrides,
    });

    expect(messagesOf(result)).toEqual([message]);
  });

  test('25文字の絵文字のニックネームと、補助面の文字を数えた128文字のパスワードを受け付ける', () => {
    const result = REGISTER_FORM_SCHEMA.safeParse({
      ...VALID_REGISTRATION,
      nickname: '👨‍👩‍👧'.repeat(25),
      password: '𠮷'.repeat(128),
    });

    expect(result.success).toBe(true);
  });
});

describe('LOGIN_FORM_SCHEMA', () => {
  test('登録済みのパスワードの照合では文字数の下限を問わない', () => {
    expect(
      LOGIN_FORM_SCHEMA.parse({ email: 'maker@launch.example', password: 'a' }),
    ).toEqual({ email: 'maker@launch.example', password: 'a' });
  });

  test.each([
    ['空のパスワード', '', 'パスワードを入力してください。'],
    [
      '129文字のパスワード',
      'a'.repeat(129),
      'パスワードは8文字以上128文字以内で入力してください。',
    ],
  ])('%sは拒否する', (_name, password, message) => {
    const result = LOGIN_FORM_SCHEMA.safeParse({
      email: 'maker@launch.example',
      password,
    });

    expect(messagesOf(result)).toEqual([message]);
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
    [TOTP_CODE_FORM_SCHEMA, { totpCode: '' }, '認証コードを入力してください。'],
    [
      TOTP_CODE_FORM_SCHEMA,
      { totpCode: '1'.repeat(65) },
      '認証コードが正しくありません。',
    ],
    [
      RECOVERY_CODE_FORM_SCHEMA,
      { recoveryCode: ' ' },
      'リカバリコードを入力してください。',
    ],
    [
      RECOVERY_CODE_FORM_SCHEMA,
      { recoveryCode: 'a'.repeat(65) },
      '認証コードが正しくありません。',
    ],
  ])('未入力と長すぎる値を拒否する(%#)', (schema, secondFactor, message) => {
    expect(messagesOf(schema.safeParse({ secondFactor }))).toEqual([message]);
  });
});

describe('PASSWORD_RESET_REQUEST_FORM_SCHEMA', () => {
  test('メールアドレスの前後の空白を除いた値だけを出力する', () => {
    expect(
      PASSWORD_RESET_REQUEST_FORM_SCHEMA.parse({
        email: ' maker@launch.example\n',
      }),
    ).toEqual({ email: 'maker@launch.example' });
  });

  test.each([
    ['', 'メールアドレスを入力してください。'],
    ['maker@', 'メールアドレスの形式が正しくありません。'],
  ])('メールアドレス「%s」は「%s」で拒否する', (email, message) => {
    expect(
      messagesOf(PASSWORD_RESET_REQUEST_FORM_SCHEMA.safeParse({ email })),
    ).toEqual([message]);
  });
});

describe('PASSWORD_RESET_FORM_SCHEMA', () => {
  test('新しいパスワードだけを出力し、リンクのトークンを入力に含めない', () => {
    expect(
      PASSWORD_RESET_FORM_SCHEMA.parse({
        newPassword: VALID_PASSWORD,
        token: 'link-token',
      }),
    ).toEqual({ newPassword: VALID_PASSWORD });
  });

  test.each([
    ['空', ''],
    ['7文字', 'a'.repeat(7)],
    ['129文字', 'a'.repeat(129)],
  ])('%sの新しいパスワードは文字数の文言で拒否する', (_name, newPassword) => {
    expect(
      messagesOf(PASSWORD_RESET_FORM_SCHEMA.safeParse({ newPassword })),
    ).toEqual(['パスワードは8文字以上128文字以内で入力してください。']);
  });

  test.each([8, 128])('%i文字の新しいパスワードを受け付ける', (length) => {
    expect(
      PASSWORD_RESET_FORM_SCHEMA.safeParse({ newPassword: 'a'.repeat(length) })
        .success,
    ).toBe(true);
  });
});

const REAUTHENTICATION_INPUT = Object.freeze({
  currentPassword: VALID_PASSWORD,
  secondFactor: { totpCode: '123456', recoveryCode: 'abcd-efgh' },
});

describe('本人確認の欄を持つスキーマ', () => {
  test.each([
    ['password', { currentPassword: VALID_PASSWORD }],
    [
      'totp',
      { currentPassword: VALID_PASSWORD, secondFactor: { totpCode: '123456' } },
    ],
    [
      'recovery',
      {
        currentPassword: VALID_PASSWORD,
        secondFactor: { recoveryCode: 'abcd-efgh' },
      },
    ],
  ] as const)(
    '退会のスキーマは、%sの本人確認では描いている欄だけを出力する',
    (mode, expected) => {
      expect(
        WITHDRAWAL_FORM_SCHEMAS[mode].parse(REAUTHENTICATION_INPUT),
      ).toEqual(expected);
    },
  );

  test('メールアドレス変更のスキーマは、新しいメールアドレスの前後の空白を除き、本人確認を入れ子で出力する', () => {
    expect(
      EMAIL_CHANGE_FORM_SCHEMAS.totp.parse({
        newEmail: ' new@launch.example ',
        reAuthentication: REAUTHENTICATION_INPUT,
      }),
    ).toEqual({
      newEmail: 'new@launch.example',
      reAuthentication: {
        currentPassword: VALID_PASSWORD,
        secondFactor: { totpCode: '123456' },
      },
    });
  });

  test('パスワード変更のスキーマは、多要素認証が無効なら第2要素を出力しない', () => {
    expect(
      PASSWORD_CHANGE_FORM_SCHEMAS.password.parse({
        newPassword: VALID_PASSWORD,
        reAuthentication: REAUTHENTICATION_INPUT,
      }),
    ).toEqual({
      newPassword: VALID_PASSWORD,
      reAuthentication: { currentPassword: VALID_PASSWORD },
    });
  });

  test.each([
    [
      '空の現在のパスワード',
      { currentPassword: '', secondFactor: { totpCode: '123456' } },
      'パスワードを入力してください。',
    ],
    [
      '空の認証コード',
      { currentPassword: VALID_PASSWORD, secondFactor: { totpCode: ' ' } },
      '認証コードを入力してください。',
    ],
  ])('退会のスキーマは%sを拒否する', (_name, input, message) => {
    expect(messagesOf(WITHDRAWAL_FORM_SCHEMAS.totp.safeParse(input))).toEqual([
      message,
    ]);
  });

  test('メールアドレス変更のスキーマは空の新しいメールアドレスを拒否する', () => {
    expect(
      messagesOf(
        EMAIL_CHANGE_FORM_SCHEMAS.password.safeParse({
          newEmail: '',
          reAuthentication: { currentPassword: VALID_PASSWORD },
        }),
      ),
    ).toEqual(['メールアドレスを入力してください。']);
  });

  test('パスワード変更のスキーマは7文字の新しいパスワードを拒否する', () => {
    expect(
      messagesOf(
        PASSWORD_CHANGE_FORM_SCHEMAS.password.safeParse({
          newPassword: 'a'.repeat(7),
          reAuthentication: { currentPassword: VALID_PASSWORD },
        }),
      ),
    ).toEqual(['パスワードは8文字以上128文字以内で入力してください。']);
  });
});
