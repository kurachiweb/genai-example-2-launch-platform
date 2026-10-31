import { describe, expect, test } from 'bun:test';

import { hasForbiddenCharacters } from './text-safety.ts';

describe('hasForbiddenCharacters', () => {
  test.each([
    ['空文字列', ''],
    ['日本語と英数字', 'ローンチ準備OK 123'],
    ['タブ', 'a\tb'],
    ['改行', 'a\nb'],
    ['CR', 'a\rb'],
    ['CRLF', 'a\r\nb'],
    ['対になったサロゲート', '𠮷👨‍👩‍👧‍👦🇯🇵'],
    ['結合文字', '\u304b\u3099e\u0301'],
    ['全角空白とノーブレークスペース', '\u3000\u00a0'],
    ['C1制御文字の範囲の外の文字', '\u007e\u00a0\u00ff'],
  ])('%sを禁止文字と判定しない', (_, text) => {
    expect(hasForbiddenCharacters(text)).toBe(false);
  });

  test.each([
    ['孤立した上位サロゲート', 'a\ud83db'],
    ['孤立した下位サロゲート', 'a\udc4db'],
    ['末尾の孤立した上位サロゲート', 'abc\ud83d'],
    ['順序が逆のサロゲート', '\ude00\ud83d'],
  ])('%sを禁止文字と判定する', (_, text) => {
    expect(hasForbiddenCharacters(text)).toBe(true);
  });

  test.each([
    ['NUL', '\u0000'],
    ['SOH', '\u0001'],
    ['BS', '\u0008'],
    ['VT', '\u000b'],
    ['FF', '\u000c'],
    ['SO', '\u000e'],
    ['ESC', '\u001b'],
    ['US', '\u001f'],
    ['DEL', '\u007f'],
    ['C1制御文字の先頭(U+0080)', '\u0080'],
    ['NEL(U+0085)', '\u0085'],
    ['CSI(U+009B)', '\u009b'],
    ['APC(U+009F)', '\u009f'],
  ])('制御文字の%sを禁止文字と判定する', (_, character) => {
    expect(hasForbiddenCharacters(`本文${character}の途中`)).toBe(true);
  });

  test('タブ・改行・CRと禁止文字が混在する場合は禁止文字と判定する', () => {
    expect(hasForbiddenCharacters('a\tb\r\nc\u0000')).toBe(true);
  });
});
