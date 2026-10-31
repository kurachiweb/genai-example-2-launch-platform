import { describe, expect, test } from 'bun:test';

import { separateEmoji } from './emoji-separator.ts';

describe('separateEmoji', () => {
  test.each([
    ['Unicode 6.1より後の絵文字', '🦄'],
    ['Unicode 6.1までの絵文字', '🚀'],
    ['未割り当ての絵文字の範囲', '\u{1fc00}'],
    ['著作権記号', '©'],
    ['肌色の修飾', '🏽'],
    ['地域指示記号', '🇯'],
    ['ゼロ幅接合子', '\u200d'],
    ['キーキャップ', '\u20e3'],
    ['テキストの異体字セレクタ', '\ufe0e'],
    ['絵文字の異体字セレクタ', '\ufe0f'],
    ['タグ文字の先頭', '\u{e0020}'],
    ['タグ文字の終わり', '\u{e007f}'],
  ])('%sを絵文字の並びの文字として半角スペースに置き換える', (_, character) => {
    expect(separateEmoji(`a${character}b`)).toBe('a b');
  });

  test.each([
    ['数字', '1'],
    ['#', '#'],
    ['*', '*'],
    ['英字', 'a'],
    ['漢数字のゼロ', '〇'],
    ['郵便記号', '〒'],
    ['締め', '〆'],
    ['踊り字', '々'],
    ['ゼロ幅非接合子', '\u200c'],
    ['他の異体字セレクタ', '\ufe00'],
    ['漢字の異体字セレクタ', '\u{e0100}'],
    ['タグ文字の手前', '\u{e001f}'],
    ['タグ文字の後', '\u{e0080}'],
  ])('%sを絵文字の並びの文字として扱わずに残す', (_, character) => {
    expect(separateEmoji(`a${character}b`)).toBe(`a${character}b`);
  });

  test('絵文字の並びの文字を1文字ずつ半角スペースに置き換える', () => {
    expect(separateEmoji('a👍🏽b🇯🇵c')).toBe('a  b  c');
  });

  test('キーキャップの土台の数字を残す', () => {
    expect(separateEmoji('1\ufe0f\u20e3')).toBe('1  ');
  });

  test('絵文字を含まない文字列を変えない', () => {
    expect(separateEmoji('タスク管理 〇〒 #1')).toBe('タスク管理 〇〒 #1');
  });
});
