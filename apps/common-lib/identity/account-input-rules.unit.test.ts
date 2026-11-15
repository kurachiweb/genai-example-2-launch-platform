import { describe, expect, test } from 'bun:test';

import {
  checkNickname,
  checkPasswordLength,
  countCodePoints,
  EMAIL_MAX_LENGTH,
  NICKNAME_MAX_GRAPHEMES,
  PASSWORD_MAX_CODE_POINTS,
  PASSWORD_MIN_CODE_POINTS,
} from './account-input-rules.ts';

const FAMILY_EMOJI = '👨‍👩‍👧‍👦';

const COMBINED_KANA = '\u304b\u3099';

const KEY_EMOJI = '🔑';

const EMAIL_DOMAIN = '@mail.example';

const emailOfLength = (length: number): string =>
  `${'a'.repeat(length - EMAIL_DOMAIN.length)}${EMAIL_DOMAIN}`;

describe('入力の上限の定数', () => {
  test('要件の値と一致する', () => {
    expect({
      NICKNAME_MAX_GRAPHEMES,
      EMAIL_MAX_LENGTH,
      PASSWORD_MIN_CODE_POINTS,
      PASSWORD_MAX_CODE_POINTS,
    }).toEqual({
      NICKNAME_MAX_GRAPHEMES: 25,
      EMAIL_MAX_LENGTH: 254,
      PASSWORD_MIN_CODE_POINTS: 8,
      PASSWORD_MAX_CODE_POINTS: 128,
    });
  });
});

describe('checkNickname', () => {
  test.each([
    ['半角英字の25書記素', 'a'.repeat(25)],
    ['ZWJで結合した絵文字の25書記素', FAMILY_EMOJI.repeat(25)],
    ['結合文字の濁点の25書記素', COMBINED_KANA.repeat(25)],
    [
      '絵文字・結合文字・全角文字が混在した25書記素',
      `${FAMILY_EMOJI}${COMBINED_KANA}${'ロ'.repeat(23)}`,
    ],
    ['1書記素', 'a'],
    ['前後の空白を除くと25書記素', ` \u3000${'a'.repeat(25)}\t\n`],
  ])('%sを受け付ける', (_, value) => {
    expect(checkNickname(value)).toBe('ok');
  });

  test.each([
    ['半角英字の26書記素', 'a'.repeat(26)],
    ['ZWJで結合した絵文字の26書記素', FAMILY_EMOJI.repeat(26)],
    ['結合文字の濁点の26書記素', COMBINED_KANA.repeat(26)],
    ['途中の空白を含めて26書記素', `${'a'.repeat(12)} ${'a'.repeat(13)}`],
  ])('%sを長すぎると判定する', (_, value) => {
    expect(checkNickname(value)).toBe('too-long');
  });

  test.each([
    ['空文字列', ''],
    ['半角スペースだけ', '   '],
    ['全角空白・タブ・改行だけ', '\u3000\t\r\n\u3000'],
  ])('%sを空と判定する', (_, value) => {
    expect(checkNickname(value)).toBe('empty');
  });
});

describe('countCodePoints', () => {
  test.each([
    ['空文字列', '', 0],
    ['半角英数字', 'abc123', 6],
    ['サロゲートペアの文字', `${KEY_EMOJI}𠮷`, 2],
    ['ZWJで結合した絵文字', FAMILY_EMOJI, 7],
    ['結合文字', COMBINED_KANA, 2],
    ['対になっていないサロゲート', 'a\ud83db\ude00', 4],
  ])('%sのコードポイント数を数える', (_, value, expected) => {
    expect(countCodePoints(value)).toBe(expected);
  });
});

describe('checkPasswordLength', () => {
  test.each([
    ['半角英字の8コードポイント', 'a'.repeat(8)],
    ['半角英字の128コードポイント', 'a'.repeat(128)],
    ['サロゲートペアの8コードポイント', KEY_EMOJI.repeat(8)],
    ['サロゲートペアの128コードポイント', KEY_EMOJI.repeat(128)],
    ['結合文字を含む8コードポイント', `${COMBINED_KANA.repeat(3)}ab`],
  ])('%sを受け付ける', (_, value) => {
    expect(checkPasswordLength(value)).toBe('ok');
  });

  test.each([
    ['半角英字の7コードポイント', 'a'.repeat(7)],
    ['UTF-16で14単位のサロゲートペアの7コードポイント', KEY_EMOJI.repeat(7)],
    ['空文字列', ''],
  ])('%sを短すぎると判定する', (_, value) => {
    expect(checkPasswordLength(value)).toBe('too-short');
  });

  test.each([
    ['半角英字の129コードポイント', 'a'.repeat(129)],
    ['サロゲートペアの129コードポイント', KEY_EMOJI.repeat(129)],
  ])('%sを長すぎると判定する', (_, value) => {
    expect(checkPasswordLength(value)).toBe('too-long');
  });

  test('前後の空白を除かずに数える', () => {
    expect(checkPasswordLength(`   ${'a'.repeat(5)}`)).toBe('ok');
  });
});

describe('メールアドレスの長さの上限', () => {
  test.each([
    [254, true],
    [255, false],
  ])('%i文字のアドレスを上限内とする判定が%pになる', (length, expected) => {
    const address = emailOfLength(length);

    expect(address).toHaveLength(length);
    expect(address.length <= EMAIL_MAX_LENGTH).toBe(expected);
  });
});
