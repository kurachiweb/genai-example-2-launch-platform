import { describe, expect, test } from 'bun:test';

import {
  CHAT_MESSAGE_MAX,
  checkChatMessage,
  checkGuestNickname,
  checkInquiryBody,
  GUEST_NICKNAME_MAX,
  INQUIRY_BODY_MAX,
  type InquiryTextIssue,
} from './inquiry-input-rules.ts';

const FAMILY_EMOJI = '👨‍👩‍👧‍👦';

const COMBINED_KANA = '\u304b\u3099';

const VARIATION_SELECTOR_KANJI = '\u845b\u{e0101}';

const SURROUNDING_SPACES = ' \u3000\t\r\n';

const RULES: readonly (readonly [
  string,
  (value: string) => InquiryTextIssue | undefined,
  number,
])[] = [
  ['ニックネーム', checkGuestNickname, 25],
  ['本文', checkInquiryBody, 5_000],
  ['チャットのメッセージ', checkChatMessage, 1_000],
];

describe('入力の上限の定数', () => {
  test('要件の書記素の数と一致する', () => {
    expect({ GUEST_NICKNAME_MAX, INQUIRY_BODY_MAX, CHAT_MESSAGE_MAX }).toEqual({
      GUEST_NICKNAME_MAX: 25,
      INQUIRY_BODY_MAX: 5_000,
      CHAT_MESSAGE_MAX: 1_000,
    });
  });
});

describe.each(RULES)('%sの判定', (_, check, max) => {
  test.each([
    ['1書記素', 'a'],
    ['半角英字の上限ちょうど', 'a'.repeat(max)],
    ['ZWJで結合した絵文字の上限ちょうど', FAMILY_EMOJI.repeat(max)],
    ['結合文字の濁点の上限ちょうど', COMBINED_KANA.repeat(max)],
    [
      '異体字セレクタ付きの漢字の上限ちょうど',
      VARIATION_SELECTOR_KANJI.repeat(max),
    ],
    [
      '前後の空白を除いて上限ちょうど',
      `${SURROUNDING_SPACES}${'a'.repeat(max)}${SURROUNDING_SPACES}`,
    ],
    ['途中の空白・タブ・改行', 'a b\tc\nd\r\ne'],
  ])('%sを受け付ける', (__, value) => {
    expect(check(value)).toBeUndefined();
  });

  test.each([
    ['半角英字の上限+1', 'a'.repeat(max + 1)],
    ['ZWJで結合した絵文字の上限+1', FAMILY_EMOJI.repeat(max + 1)],
    ['結合文字の濁点の上限+1', COMBINED_KANA.repeat(max + 1)],
    ['途中の空白を含めて上限+1', `${'a'.repeat(max - 1)} a`],
  ])('%sを長すぎると判定する', (__, value) => {
    expect(check(value)).toBe('too-long');
  });

  test.each([
    ['空文字列', ''],
    ['半角スペースだけ', '   '],
    ['全角空白・タブ・改行だけ', '\u3000\t\r\n\u3000'],
    ['上限を超える数の空白だけ', ' '.repeat(max + 10)],
  ])('%sを空と判定する', (__, value) => {
    expect(check(value)).toBe('empty');
  });

  test.each([
    ['NUL', 'a\u0000b'],
    ['C0制御文字', 'a\u0001b'],
    ['DEL', 'a\u007fb'],
    ['C1制御文字', 'a\u0085b'],
    ['対になっていないサロゲート', 'a\ud800b'],
  ])('%sを使用できない文字と判定する', (__, value) => {
    expect(check(value)).toBe('forbidden-character');
  });

  describe('判定の順', () => {
    test('空白に囲まれた使用できない文字だけの入力を空でなく使用できない文字と判定する', () => {
      expect(check('  \u0001  ')).toBe('forbidden-character');
    });

    test.each([
      ['先頭のVT', '\u000ba'],
      ['末尾のFF', 'a\u000c'],
      ['末尾のNEL', 'a\u0085'],
      ['VTだけ', '\u000b'],
    ])(
      '空白でもある制御文字(%s)を前後の空白として除かずに使用できない文字と判定する',
      (__, value) => {
        expect(check(value)).toBe('forbidden-character');
      },
    );

    test('使用できない文字を長さより先に判定する', () => {
      expect(check(`${'a'.repeat(max + 1)}\u0001`)).toBe('forbidden-character');
    });
  });
});

describe('要件の境界の値', () => {
  test.each([
    ['ニックネームの25書記素', checkGuestNickname, 'あ'.repeat(25), undefined],
    ['ニックネームの26書記素', checkGuestNickname, 'あ'.repeat(26), 'too-long'],
    ['本文の5,000書記素', checkInquiryBody, 'あ'.repeat(5_000), undefined],
    ['本文の5,001書記素', checkInquiryBody, 'あ'.repeat(5_001), 'too-long'],
    ['チャットの1,000書記素', checkChatMessage, 'あ'.repeat(1_000), undefined],
    ['チャットの1,001書記素', checkChatMessage, 'あ'.repeat(1_001), 'too-long'],
  ] as const)('%sを判定する', (_, check, value, expected) => {
    expect(check(value)).toBe(expected);
  });
});
