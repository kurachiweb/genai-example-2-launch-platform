import { describe, expect, test } from 'bun:test';

import { normalizeWebsites } from './website-list.ts';

describe('normalizeWebsites', () => {
  test('空の配列は空の配列のままになる', () => {
    expect(normalizeWebsites([])).toEqual([]);
  });

  test('名前とURLの前後の空白を除く', () => {
    expect(
      normalizeWebsites([
        { name: '  個人サイト \t', url: '\n https://example.com/me  ' },
      ]),
    ).toEqual([{ name: '個人サイト', url: 'https://example.com/me' }]);
  });

  test('全角空白も前後の空白として除く', () => {
    expect(
      normalizeWebsites([
        { name: '　ブログ　', url: '　https://example.com　' },
      ]),
    ).toEqual([{ name: 'ブログ', url: 'https://example.com' }]);
  });

  test('名前の途中の空白は保つ', () => {
    expect(
      normalizeWebsites([{ name: 'my  blog', url: 'https://example.com' }]),
    ).toEqual([{ name: 'my  blog', url: 'https://example.com' }]);
  });

  test('名前がnullならnullのままになる', () => {
    expect(
      normalizeWebsites([{ name: null, url: 'https://example.com' }]),
    ).toEqual([{ name: null, url: 'https://example.com' }]);
  });

  test('空文字の名前は未入力としてnullになる', () => {
    expect(
      normalizeWebsites([{ name: '', url: 'https://example.com' }]),
    ).toEqual([{ name: null, url: 'https://example.com' }]);
  });

  test('空白だけの名前は未入力としてnullになる', () => {
    expect(
      normalizeWebsites([{ name: ' 　\t ', url: 'https://example.com' }]),
    ).toEqual([{ name: null, url: 'https://example.com' }]);
  });

  test('URLが空でも行を落とさず空文字のまま返して検証へ委ねる', () => {
    expect(normalizeWebsites([{ name: '名前', url: '   ' }])).toEqual([
      { name: '名前', url: '' },
    ]);
  });

  test('複数行の順序と件数を保つ', () => {
    expect(
      normalizeWebsites([
        { name: 'b', url: ' https://b.example ' },
        { name: ' ', url: 'https://a.example' },
        { name: 'c', url: 'https://c.example' },
      ]),
    ).toEqual([
      { name: 'b', url: 'https://b.example' },
      { name: null, url: 'https://a.example' },
      { name: 'c', url: 'https://c.example' },
    ]);
  });

  test('入力の配列と要素を書き換えない', () => {
    const input = [{ name: ' a ', url: ' https://a.example ' }];
    const snapshot = structuredClone(input);

    const result = normalizeWebsites(input);

    expect(input).toEqual(snapshot);
    expect(result).not.toBe(input);
    expect(result[0]).not.toBe(input[0]);
  });
});
