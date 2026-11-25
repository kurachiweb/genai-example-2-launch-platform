import { describe, expect, test } from 'bun:test';

import { INFRINGEMENT_INQUIRY_FORM_SCHEMA } from './infringement-inquiry-form-schema.ts';

const messagesOf = (input: { message: string; reason: string }) => {
  const result = INFRINGEMENT_INQUIRY_FORM_SCHEMA.safeParse(input);
  return result.success
    ? []
    : result.error.issues.map(({ path, message }) => ({
        path: path.join('.'),
        message,
      }));
};

describe('照会のフォームの検証', () => {
  test('空と空白だけの内容は未入力の文言にする', () => {
    expect(messagesOf({ message: ' 　\n', reason: '' })).toStrictEqual([
      { path: 'message', message: '照会の内容を入力してください。' },
    ]);
  });

  test('前後の空白を除いて1,000書記素を超える内容は文字数超過の文言にする', () => {
    expect(
      messagesOf({ message: `  ${'あ'.repeat(1001)}  `, reason: '' }),
    ).toStrictEqual([
      {
        path: 'message',
        message: '照会の内容は1,000文字以内で入力してください。',
      },
    ]);
    expect(
      messagesOf({ message: `  ${'👨‍👩‍👧'.repeat(1000)}  `, reason: '' }),
    ).toStrictEqual([]);
  });

  test('内容は値を変えずに送り、理由は任意で前後の空白を除き、空なら送らない', () => {
    expect(
      INFRINGEMENT_INQUIRY_FORM_SCHEMA.parse({
        message: ' 確認をお願いします\n',
        reason: '  権利者の申出のため ',
      }),
    ).toStrictEqual({
      message: ' 確認をお願いします\n',
      reason: '権利者の申出のため',
    });
    expect(
      INFRINGEMENT_INQUIRY_FORM_SCHEMA.parse({ message: '確認', reason: ' ' }),
    ).toStrictEqual({ message: '確認', reason: undefined });
  });

  test('理由は500文字を超えると拒否する', () => {
    expect(
      messagesOf({ message: '確認', reason: 'あ'.repeat(501) }).map(
        ({ path }) => path,
      ),
    ).toStrictEqual(['reason']);
  });
});
