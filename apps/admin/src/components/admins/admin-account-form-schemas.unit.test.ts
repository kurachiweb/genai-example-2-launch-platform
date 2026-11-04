import { describe, expect, test } from 'bun:test';

import {
  ADMIN_PROFILE_FORM_SCHEMA,
  CHANGE_ROLE_FORM_SCHEMA,
  INVITE_ADMIN_FORM_SCHEMA,
} from './admin-account-form-schemas.ts';

const messagesOf = (result: {
  readonly error?: { readonly issues: readonly { message: string }[] };
}): readonly string[] =>
  result.error?.issues.map(({ message }) => message) ?? [];

describe('INVITE_ADMIN_FORM_SCHEMA', () => {
  test('前後の空白を除いたメールアドレスと、空の理由を未指定にした値を返す', () => {
    expect(
      INVITE_ADMIN_FORM_SCHEMA.parse({
        email: '  new-admin@admin.example ',
        reason: '　',
      }),
    ).toStrictEqual({ email: 'new-admin@admin.example', reason: undefined });
  });

  test('理由は前後の空白を除いて送る', () => {
    expect(
      INVITE_ADMIN_FORM_SCHEMA.parse({
        email: 'new-admin@admin.example',
        reason: ' 運営の増員 ',
      }).reason,
    ).toBe('運営の増員');
  });

  test('形式の正しくないメールアドレスは、APIと同じ文言で拒否する', () => {
    expect(
      messagesOf(
        INVITE_ADMIN_FORM_SCHEMA.safeParse({ email: 'admin', reason: '' }),
      ),
    ).toStrictEqual(['メールアドレスの形式が正しくありません。']);
  });

  test('500文字を超える理由は拒否する', () => {
    expect(
      messagesOf(
        INVITE_ADMIN_FORM_SCHEMA.safeParse({
          email: 'new-admin@admin.example',
          reason: 'あ'.repeat(501),
        }),
      ),
    ).toStrictEqual(['理由は500文字以内で入力してください。']);
  });
});

describe('CHANGE_ROLE_FORM_SCHEMA', () => {
  test('選んだロールと理由を返す', () => {
    expect(
      CHANGE_ROLE_FORM_SCHEMA.parse({ role: 'moderator', reason: '' }),
    ).toStrictEqual({ role: 'moderator', reason: undefined });
  });

  test.each(['', 'admin'])('ロールの値%sは選び直しを求める', (role) => {
    expect(
      messagesOf(CHANGE_ROLE_FORM_SCHEMA.safeParse({ role, reason: '' })),
    ).toStrictEqual(['変更後のロールを選んでください。']);
  });
});

describe('ADMIN_PROFILE_FORM_SCHEMA', () => {
  test('前後の空白を除いたニックネームと肩書きと、画像の識別子を返す', () => {
    expect(
      ADMIN_PROFILE_FORM_SCHEMA.parse({
        nickname: ' 審査の担当 ',
        title: ' モデレーション担当 ',
        avatarFileId: '01JC0AVATAR00000000000000000',
      }),
    ).toStrictEqual({
      nickname: '審査の担当',
      title: 'モデレーション担当',
      avatarFileId: '01JC0AVATAR00000000000000000',
    });
  });

  test('空白だけの肩書きと取り除いた画像は未設定のnullにする', () => {
    expect(
      ADMIN_PROFILE_FORM_SCHEMA.parse({
        nickname: '審査の担当',
        title: '　',
        avatarFileId: null,
      }),
    ).toStrictEqual({
      nickname: '審査の担当',
      title: null,
      avatarFileId: null,
    });
  });

  test('ニックネームの未入力と上限超え、肩書きの上限超えを、APIと同じ文言で拒否する', () => {
    expect(
      messagesOf(
        ADMIN_PROFILE_FORM_SCHEMA.safeParse({
          nickname: '',
          title: 'あ'.repeat(51),
          avatarFileId: null,
        }),
      ),
    ).toStrictEqual([
      'ニックネームを入力してください。',
      '肩書きは50文字以内で入力してください。',
    ]);
    expect(
      messagesOf(
        ADMIN_PROFILE_FORM_SCHEMA.safeParse({
          nickname: 'あ'.repeat(26),
          title: '',
          avatarFileId: null,
        }),
      ),
    ).toStrictEqual(['ニックネームは25文字以内で入力してください。']);
  });

  test('上限ちょうどの文字数は受け付ける', () => {
    expect(
      ADMIN_PROFILE_FORM_SCHEMA.safeParse({
        nickname: 'あ'.repeat(25),
        title: 'あ'.repeat(50),
        avatarFileId: null,
      }).success,
    ).toBe(true);
  });
});
