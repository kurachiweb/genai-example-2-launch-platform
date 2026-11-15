import { describe, expect, test } from 'bun:test';

import {
  IMPERSONATION_RESERVED_HANDLES,
  isReservedHandle,
} from '../handles/handle-rules.ts';
import {
  BIO_MAX_GRAPHEMES,
  checkHeadline,
  checkWebsiteName,
  HEADLINE_MAX_GRAPHEMES,
  PROFILE_WEBSITES_MAX,
  USER_AVATAR_MAX_BYTES,
  USER_AVATAR_PURPOSE,
  USER_HANDLE_RULE,
  WEBSITE_NAME_MAX_GRAPHEMES,
} from './profile-input-rules.ts';

const FAMILY_EMOJI = '👨‍👩‍👧‍👦';

const COMBINED_KANA = '\u304b\u3099';

describe('定数', () => {
  test('要件の値と一致する', () => {
    expect({
      HEADLINE_MAX_GRAPHEMES,
      BIO_MAX_GRAPHEMES,
      WEBSITE_NAME_MAX_GRAPHEMES,
      PROFILE_WEBSITES_MAX,
      USER_AVATAR_PURPOSE,
      USER_AVATAR_MAX_BYTES,
    }).toEqual({
      HEADLINE_MAX_GRAPHEMES: 50,
      BIO_MAX_GRAPHEMES: 5000,
      WEBSITE_NAME_MAX_GRAPHEMES: 25,
      PROFILE_WEBSITES_MAX: 10,
      USER_AVATAR_PURPOSE: 'user-avatar',
      USER_AVATAR_MAX_BYTES: 512_000,
    });
  });
});

describe('USER_HANDLE_RULE', () => {
  test('上限は25文字で、予約語は14語である', () => {
    expect(USER_HANDLE_RULE.maxLength).toBe(25);
    expect(USER_HANDLE_RULE.reservedWords).toEqual(
      IMPERSONATION_RESERVED_HANDLES,
    );
  });

  test('予約語の判定に使える', () => {
    expect(isReservedHandle('Admin', USER_HANDLE_RULE)).toBe(true);
    expect(isReservedHandle('admin1', USER_HANDLE_RULE)).toBe(false);
  });
});

const TEXT_RULES: readonly (readonly [
  string,
  (value: string) => 'ok' | 'too-long' | 'forbidden-characters',
  number,
])[] = [
  ['ヘッドライン', checkHeadline, 50],
  ['外部Webサイトの名前', checkWebsiteName, 25],
];

describe.each(TEXT_RULES)('%sの検査', (_, check, max) => {
  test('空文字列は任意のためokと判定する', () => {
    expect(check('')).toBe('ok');
  });

  test('空白だけの値はokと判定する', () => {
    expect(check(' 　\t\r\n ')).toBe('ok');
  });

  test('上限ちょうどの書記素をokと判定する', () => {
    expect(check('あ'.repeat(max))).toBe('ok');
  });

  test('上限を1書記素超える値をtoo-longと判定する', () => {
    expect(check('あ'.repeat(max + 1))).toBe('too-long');
  });

  test('前後の空白は数えない', () => {
    expect(check(` \u3000${'あ'.repeat(max)}\u3000 `)).toBe('ok');
  });

  test('途中の空白は数える', () => {
    expect(check(`${'あ'.repeat(max)} あ`)).toBe('too-long');
  });

  test('家族の絵文字・結合文字は1書記素と数える', () => {
    expect(check(FAMILY_EMOJI.repeat(max))).toBe('ok');
    expect(check(COMBINED_KANA.repeat(max))).toBe('ok');
    expect(check(FAMILY_EMOJI.repeat(max + 1))).toBe('too-long');
  });

  test('対になっていないサロゲートをforbidden-charactersと判定する', () => {
    expect(check('a\ud800b')).toBe('forbidden-characters');
  });

  test('制御文字をforbidden-charactersと判定する', () => {
    expect(check('a\u0000b')).toBe('forbidden-characters');
    expect(check('a\u007fb')).toBe('forbidden-characters');
    expect(check('a\u0085b')).toBe('forbidden-characters');
  });

  test('端にある空白でもある制御文字は除かずにforbidden-charactersと判定する', () => {
    expect(check('\u000bab')).toBe('forbidden-characters');
  });

  test('上限超過と禁止文字が重なる値は禁止文字を先に示す', () => {
    expect(check(`${'あ'.repeat(max + 1)}\u0000`)).toBe('forbidden-characters');
  });
});
