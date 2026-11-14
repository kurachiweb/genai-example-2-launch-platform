import { describe, expect, test } from 'bun:test';

import { countGraphemes, truncateGraphemes } from './graphemes.ts';

describe('countGraphemes', () => {
  test('空文字列を0文字と数える', () => {
    expect(countGraphemes('')).toBe(0);
  });

  test.each([
    ['半角英数字', 'abc123', 6],
    ['全角文字', 'ローンチ', 4],
    ['全角と半角の混在', 'Launch準備OK', 10],
    ['サロゲートペアの漢字', '𠮷野家', 3],
  ])('%sを1文字ずつ数える', (_, text, expected) => {
    expect(countGraphemes(text)).toBe(expected);
  });

  test.each([
    ['ZWJで結合した家族の絵文字', '👨‍👩‍👧‍👦'],
    ['ZWJで結合した職業の絵文字', '🧑‍💻'],
    ['肌色の修飾を付けた絵文字', '👍🏽'],
    ['肌色の修飾とZWJを組み合わせた絵文字', '🧑🏾‍🚀'],
    ['国旗', '🇯🇵'],
    ['異体字セレクタを付けた絵文字', '❤️'],
    ['キーキャップの絵文字', '1️⃣'],
    ['結合文字の濁点', '\u304b\u3099'],
    ['結合文字のアクセント', 'e\u0301'],
    ['複数の結合文字', 'a\u0323\u0301'],
    ['CRLF', '\r\n'],
  ])('%sを1文字と数える', (_, text) => {
    expect(countGraphemes(text)).toBe(1);
  });

  test('絵文字・結合文字・改行を含む文章を利用者が見る文字の単位で数える', () => {
    expect(countGraphemes('祝🇯🇵\r\nリリース👨‍👩‍👧‍👦です')).toBe(10);
  });

  test('並んだ国旗をそれぞれ1文字と数える', () => {
    expect(countGraphemes('🇯🇵🇺🇸🇫🇷')).toBe(3);
  });
});

describe('truncateGraphemes', () => {
  test('上限以内の文字列をそのまま返す', () => {
    expect(truncateGraphemes('ローンチ', 4)).toBe('ローンチ');
  });

  test('上限を超える文字列を先頭から上限の文字数へ切り詰める', () => {
    expect(truncateGraphemes('Launch準備OK', 6)).toBe('Launch');
  });

  test('結合した絵文字・国旗・結合文字を途中で分けずに切り詰める', () => {
    expect(truncateGraphemes('👨‍👩‍👧‍👦🇯🇵\u304b\u3099e', 3)).toBe('👨‍👩‍👧‍👦🇯🇵\u304b\u3099');
  });
});
