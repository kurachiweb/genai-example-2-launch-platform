import { describe, expect, test } from 'bun:test';

import {
  CHANGE_SUMMARY_MAX,
  CHANGE_SUMMARY_MESSAGES,
  changeSummarySchema,
  checkChangeSummary,
  LEGAL_BODY_MAX,
  LEGAL_BODY_RULE,
  legalBodySchema,
} from './legal-input-rules.ts';

const FAMILY_EMOJI = '👨‍👩‍👧‍👦';

const COMBINED_KANA = '\u304b\u3099';

const SURROUNDING_SPACES = ' \u3000\t';

const issueMessagesOf = (result: {
  readonly success: boolean;
  readonly error?: { readonly issues: readonly { readonly message: string }[] };
}): readonly string[] =>
  result.success
    ? []
    : (result.error?.issues ?? []).map(({ message }) => message);

describe('入力の上限の定数', () => {
  test('要件の値と一致する', () => {
    expect({ LEGAL_BODY_MAX, CHANGE_SUMMARY_MAX }).toEqual({
      LEGAL_BODY_MAX: 100_000,
      CHANGE_SUMMARY_MAX: 200,
    });
  });

  test('本文の規則が必須で上限100,000書記素の「本文」になる', () => {
    expect(LEGAL_BODY_RULE).toEqual({
      label: '本文',
      maxGraphemes: 100_000,
      required: true,
    });
    expect(Object.isFrozen(LEGAL_BODY_RULE)).toBe(true);
  });
});

describe('checkChangeSummary', () => {
  test.each([
    ['1書記素', 'a'],
    ['半角英字の200書記素', 'a'.repeat(200)],
    ['ZWJで結合した絵文字の200書記素', FAMILY_EMOJI.repeat(200)],
    ['結合文字の濁点の200書記素', COMBINED_KANA.repeat(200)],
    [
      '前後の空白と改行を除いて200書記素',
      `${SURROUNDING_SPACES}\r\n${'a'.repeat(200)}\n${SURROUNDING_SPACES}`,
    ],
    ['途中の空白とタブ', 'a b\tc'],
  ])('%sを受け付ける', (_, value) => {
    expect(checkChangeSummary(value)).toBeUndefined();
  });

  test.each([
    ['半角英字の201書記素', 'a'.repeat(201)],
    ['ZWJで結合した絵文字の201書記素', FAMILY_EMOJI.repeat(201)],
    ['結合文字の濁点の201書記素', COMBINED_KANA.repeat(201)],
    ['途中の空白を含めて201書記素', `${'a'.repeat(100)} ${'a'.repeat(100)}`],
  ])('%sを長すぎると判定する', (_, value) => {
    expect(checkChangeSummary(value)).toBe('too-long');
  });

  test.each([
    ['LF', 'a\nb'],
    ['CR', 'a\rb'],
    ['CRLF', 'a\r\nb'],
  ])('途中の%sを改行と判定する', (_, value) => {
    expect(checkChangeSummary(value)).toBe('line-break');
  });

  test.each([
    ['空文字列', ''],
    ['半角スペースだけ', '   '],
    ['全角空白・タブ・改行だけ', '\u3000\t\r\n\u3000'],
    ['上限を超える空白だけ', ' '.repeat(300)],
  ])('%sを空と判定する', (_, value) => {
    expect(checkChangeSummary(value)).toBe('empty');
  });

  test.each([
    ['NUL', 'a\u0000b'],
    ['C0制御文字', 'a\u0001b'],
    ['DEL', 'a\u007fb'],
    ['C1制御文字', 'a\u0085b'],
    ['対になっていないサロゲート', 'a\ud800b'],
  ])('%sを禁止文字と判定する', (_, value) => {
    expect(checkChangeSummary(value)).toBe('forbidden-character');
  });

  describe('判定の順', () => {
    test('禁止文字を改行より先に判定する', () => {
      expect(checkChangeSummary('a\n\u0001b')).toBe('forbidden-character');
    });

    test('空白に囲まれた禁止文字だけの入力を空でなく禁止文字と判定する', () => {
      expect(checkChangeSummary('  \u0001  ')).toBe('forbidden-character');
    });

    test.each([
      ['先頭のVT', '\u000ba'],
      ['末尾のFF', 'a\u000c'],
      ['末尾のNEL', 'a\u0085'],
      ['VTだけ', '\u000b'],
    ])(
      '空白でもある制御文字(%s)を前後の空白として除かずに禁止文字と判定する',
      (_, value) => {
        expect(checkChangeSummary(value)).toBe('forbidden-character');
      },
    );

    test('改行を長さより先に判定する', () => {
      expect(checkChangeSummary(`${'a'.repeat(200)}\n${'a'.repeat(200)}`)).toBe(
        'line-break',
      );
    });

    test('禁止文字を長さより先に判定する', () => {
      expect(checkChangeSummary(`${'a'.repeat(300)}\u0001`)).toBe(
        'forbidden-character',
      );
    });
  });
});

describe('CHANGE_SUMMARY_MESSAGES', () => {
  test('違反の種類ごとに文言規則の文言を持つ', () => {
    expect(CHANGE_SUMMARY_MESSAGES).toEqual({
      'forbidden-character': '変更概要に使用できない文字が含まれています。',
      'line-break': '変更概要に改行は使用できません。',
      empty: '変更概要を入力してください。',
      'too-long': '変更概要は200文字以内で入力してください。',
    });
    expect(Object.isFrozen(CHANGE_SUMMARY_MESSAGES)).toBe(true);
  });
});

describe('changeSummarySchema', () => {
  test('前後の空白と改行を除いた値で成功する', () => {
    expect(
      changeSummarySchema().safeParse(`${SURROUNDING_SPACES}第3条を改定\r\n`),
    ).toEqual({ success: true, data: '第3条を改定' });
  });

  test('201書記素を上限の文言で失敗させる', () => {
    expect(
      issueMessagesOf(changeSummarySchema().safeParse('a'.repeat(201))),
    ).toEqual(['変更概要は200文字以内で入力してください。']);
  });

  test.each([
    ['禁止文字', 'a\u0001b', '変更概要に使用できない文字が含まれています。'],
    ['改行', 'a\nb', '変更概要に改行は使用できません。'],
    ['空白だけ', '  ', '変更概要を入力してください。'],
  ])('%sを判定の文言の1件で失敗させる', (_, value, message) => {
    expect(issueMessagesOf(changeSummarySchema().safeParse(value))).toEqual([
      message,
    ]);
  });

  test('文字列でない値を失敗させる', () => {
    expect(changeSummarySchema().safeParse(1).success).toBe(false);
  });

  test('呼び出しごとに新しいスキーマを作る', () => {
    expect(changeSummarySchema()).not.toBe(changeSummarySchema());
  });
});

describe('legalBodySchema', () => {
  test('100,000書記素の本文を受け付ける', () => {
    expect(legalBodySchema().safeParse('あ'.repeat(100_000)).success).toBe(
      true,
    );
  });

  test('結合した絵文字の100,000書記素の本文を受け付ける', () => {
    expect(
      legalBodySchema().safeParse(FAMILY_EMOJI.repeat(100_000)).success,
    ).toBe(true);
  });

  test('100,001書記素の本文を上限の文言で失敗させる', () => {
    expect(
      issueMessagesOf(legalBodySchema().safeParse('あ'.repeat(100_001))),
    ).toEqual(['本文は100,000文字以内で入力してください。']);
  });

  test.each([
    ['空文字列', ''],
    ['空白と改行だけ', ' \u3000\n\t'],
  ])('%sの本文を必須の文言で失敗させる', (_, value) => {
    expect(issueMessagesOf(legalBodySchema().safeParse(value))).toEqual([
      '本文を入力してください。',
    ]);
  });

  test('改行を含む本文を受け付け、値を変えない', () => {
    const body = '# 第1条\n\n本文です。\r\n';

    expect(legalBodySchema().safeParse(body)).toEqual({
      success: true,
      data: body,
    });
  });
});
