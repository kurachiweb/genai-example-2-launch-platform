import { describe, expect, test } from 'bun:test';

import {
  isValidSearchTargetName,
  MAX_SEARCH_TARGET_NAME_LENGTH,
  type SearchSource,
  type SearchTargetInfo,
} from './search-target.ts';

describe('isValidSearchTargetName', () => {
  test.each([
    'a',
    'product',
    'product-review',
    'v2',
    'a1-b2-c3',
    `a${'b'.repeat(MAX_SEARCH_TARGET_NAME_LENGTH - 1)}`,
  ])(
    '小文字の英字で始まり小文字の英数字とハイフンが続く名前%pを受け付ける',
    (name) => {
      expect(isValidSearchTargetName(name)).toBe(true);
    },
  );

  test.each([
    ['空の名前', ''],
    ['数字で始まる名前', '1product'],
    ['ハイフンで始まる名前', '-product'],
    ['大文字を含む名前', 'Product'],
    ['アンダースコアを含む名前', 'product_review'],
    ['ドットを含む名前', 'product.review'],
    ['空白を含む名前', 'product review'],
    ['末尾に改行を持つ名前', 'product\n'],
    ['全角の英字を含む名前', 'ｐroduct'],
    ['上限を超える名前', `a${'b'.repeat(MAX_SEARCH_TARGET_NAME_LENGTH)}`],
  ])('%sを拒否する', (_label, name) => {
    expect(isValidSearchTargetName(name)).toBe(false);
  });

  test('名前の長さの上限は40文字である', () => {
    expect(MAX_SEARCH_TARGET_NAME_LENGTH).toBe(40);
  });
});

describe('SearchTargetInfo', () => {
  test('項目ごとに形式・元テキストの列・抽出の対象を宣言する', () => {
    const info: SearchTargetInfo<'title' | 'body'> = {
      name: 'product',
      fields: {
        title: { format: 'plain', textColumn: true, extract: true },
        body: { format: 'markdown', textColumn: false, extract: true },
      },
    };

    expect(Object.keys(info.fields)).toEqual(['title', 'body']);
  });

  test('宣言していない形式は型検査で拒否される', () => {
    const info: SearchTargetInfo<'title'> = {
      name: 'product',
      fields: {
        // @ts-expect-error 形式はplainかmarkdownだけである
        title: { format: 'html', textColumn: true, extract: true },
      },
    };

    expect(info.name).toBe('product');
  });
});

describe('SearchSource', () => {
  test('元データの版と、宣言した項目の文字列を持つ', () => {
    const source: SearchSource<'title'> = {
      version: 1_793_000_000_000,
      fields: { title: 'Launch Stadium' },
    };

    expect(source.fields.title).toBe('Launch Stadium');
  });

  test('宣言していない項目は型検査で拒否される', () => {
    const source: SearchSource<'title'> = {
      version: 1,
      // @ts-expect-error 宣言した項目以外は持てない
      fields: { title: 'a', summary: 'b' },
    };

    expect(source.version).toBe(1);
  });
});
