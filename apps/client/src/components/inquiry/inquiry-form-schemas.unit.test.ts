import { describe, expect, test } from 'bun:test';

import {
  GUEST_INQUIRY_FORM_SCHEMA,
  INQUIRY_MESSAGE_FORM_SCHEMA,
  MEMBER_INQUIRY_FORM_SCHEMA,
} from './inquiry-form-schemas.ts';

const VALID_GUEST = Object.freeze({
  categoryId: '01JC0000000000000000000000',
  nickname: 'ピッチの作り手',
  email: 'maker@launch.example',
  body: '画面が表示されません。',
});

const VALID_MEMBER = Object.freeze({
  categoryId: '01JC0000000000000000000000',
  body: '画面が表示されません。',
  fileIds: ['01JC0FILE0000000000000000A'],
});

const messagesOf = (result: {
  readonly success: boolean;
  readonly error?: { readonly issues: readonly { message: string }[] };
}): readonly string[] =>
  result.error?.issues.map(({ message }) => message) ?? [];

describe('GUEST_INQUIRY_FORM_SCHEMA', () => {
  test('ニックネームとメールアドレスの前後の空白を除き、本文は値を変えずに出力する', () => {
    const result = GUEST_INQUIRY_FORM_SCHEMA.parse({
      ...VALID_GUEST,
      nickname: '　ピッチの作り手 ',
      email: ' maker@launch.example\n',
      body: '  1行目\n2行目\n',
    });

    expect(result).toEqual({
      ...VALID_GUEST,
      body: '  1行目\n2行目\n',
    });
  });

  test.each([
    ['未選択のカテゴリ', { categoryId: '' }, 'カテゴリを選択してください。'],
    [
      '空白だけのニックネーム',
      { nickname: '　 ' },
      'ニックネームを入力してください。',
    ],
    [
      '26書記素のニックネーム',
      { nickname: 'あ'.repeat(26) },
      'ニックネームは25文字以内で入力してください。',
    ],
    [
      '使用できない文字を含むニックネーム',
      { nickname: 'ピッチ\u0007' },
      'ニックネームに使用できない文字が含まれています。',
    ],
    [
      '空のメールアドレス',
      { email: ' ' },
      'メールアドレスを入力してください。',
    ],
    [
      '形式の正しくないメールアドレス',
      { email: 'maker@' },
      'メールアドレスの形式が正しくありません。',
    ],
    ['空白だけの本文', { body: '\n　' }, 'メッセージを入力してください。'],
    [
      '5,001書記素の本文',
      { body: 'あ'.repeat(5001) },
      'メッセージは5,000文字以内で入力してください。',
    ],
    [
      '使用できない文字を含む本文',
      { body: '本文\u0007' },
      'メッセージに使用できない文字が含まれています。',
    ],
  ])('%sを、APIサーバーと同じ文言で拒否する', (_label, override, message) => {
    const result = GUEST_INQUIRY_FORM_SCHEMA.safeParse({
      ...VALID_GUEST,
      ...override,
    });

    expect(messagesOf(result)).toEqual([message]);
  });

  test('25書記素のニックネームと5,000書記素の本文を受け付ける', () => {
    const result = GUEST_INQUIRY_FORM_SCHEMA.safeParse({
      ...VALID_GUEST,
      nickname: '👨‍👩‍👧‍👦'.repeat(25),
      body: 'あ'.repeat(5000),
    });

    expect(result.success).toBe(true);
  });
});

describe('MEMBER_INQUIRY_FORM_SCHEMA', () => {
  test('入力欄を持つカテゴリ・本文・添付だけを出力する', () => {
    expect(MEMBER_INQUIRY_FORM_SCHEMA.parse(VALID_MEMBER)).toEqual(
      VALID_MEMBER,
    );
  });

  test('添付は0件でもよい', () => {
    const result = MEMBER_INQUIRY_FORM_SCHEMA.safeParse({
      ...VALID_MEMBER,
      fileIds: [],
    });

    expect(result.success).toBe(true);
  });

  test.each([
    ['未選択のカテゴリ', { categoryId: '' }, 'カテゴリを選択してください。'],
    ['空白だけの本文', { body: ' ' }, 'メッセージを入力してください。'],
    [
      '5,001書記素の本文',
      { body: 'あ'.repeat(5001) },
      'メッセージは5,000文字以内で入力してください。',
    ],
  ])('%sを、APIサーバーと同じ文言で拒否する', (_label, override, message) => {
    const result = MEMBER_INQUIRY_FORM_SCHEMA.safeParse({
      ...VALID_MEMBER,
      ...override,
    });

    expect(messagesOf(result)).toEqual([message]);
  });
});

describe('INQUIRY_MESSAGE_FORM_SCHEMA', () => {
  const VALID_MESSAGE = Object.freeze({
    body: '  追加の情報です。\n',
    fileIds: ['01JC0FILE0000000000000000A'],
  });

  test('本文は空白や改行を含めて値を変えずに、添付とともに出力する', () => {
    expect(INQUIRY_MESSAGE_FORM_SCHEMA.parse(VALID_MESSAGE)).toEqual(
      VALID_MESSAGE,
    );
  });

  test('1,000書記素の本文と0件の添付を受け付ける', () => {
    const result = INQUIRY_MESSAGE_FORM_SCHEMA.safeParse({
      body: '👨‍👩‍👧‍👦'.repeat(1000),
      fileIds: [],
    });

    expect(result.success).toBe(true);
  });

  test.each([
    ['空白だけの本文', { body: '\n　' }, 'メッセージを入力してください。'],
    [
      '1,001書記素の本文',
      { body: 'あ'.repeat(1001) },
      'メッセージは1,000文字以内で入力してください。',
    ],
    [
      '使用できない文字を含む本文',
      { body: '本文\u0007' },
      'メッセージに使用できない文字が含まれています。',
    ],
  ])('%sを、APIサーバーと同じ文言で拒否する', (_label, override, message) => {
    const result = INQUIRY_MESSAGE_FORM_SCHEMA.safeParse({
      ...VALID_MESSAGE,
      ...override,
    });

    expect(messagesOf(result)).toEqual([message]);
  });
});
