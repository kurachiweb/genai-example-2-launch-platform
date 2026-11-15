import { describe, expect, test } from 'bun:test';

import { INQUIRY_REPLY_FORM_SCHEMA } from './inquiry-reply-form-schema.ts';

const messagesOf = (input: {
  readonly body: string;
  readonly reason: string;
}): readonly string[] => {
  const result = INQUIRY_REPLY_FORM_SCHEMA.safeParse(input);
  return result.success
    ? []
    : result.error.issues.map(({ message }) => message);
};

describe('返信のフォームの検証規則', () => {
  test('1,000書記素までの本文を値を変えずに通し、空の理由をundefinedにする', () => {
    const body = ` ${'👨‍👩‍👧'.repeat(998)}\n`;

    expect(INQUIRY_REPLY_FORM_SCHEMA.parse({ body, reason: ' ' })).toEqual({
      body,
      reason: undefined,
    });
  });

  test.each([
    ['空白だけの本文', ' \n ', 'メッセージを入力してください。'],
    [
      '1,001書記素の本文',
      'あ'.repeat(1001),
      'メッセージは1,000文字以内で入力してください。',
    ],
    [
      '禁止文字を含む本文',
      '確認\u0000します',
      'メッセージに使用できない文字が含まれています。',
    ],
  ])('%sを拒否する', (_label, body, message) => {
    expect(messagesOf({ body, reason: '' })).toEqual([message]);
  });

  test('501書記素の理由を拒否する', () => {
    expect(
      messagesOf({ body: '確認します。', reason: 'あ'.repeat(501) }),
    ).toEqual(['理由は500文字以内で入力してください。']);
  });
});
