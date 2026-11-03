import { describe, expect, test } from 'bun:test';

import { toLoginSearch, toSafeReturnPath } from './return-path.ts';

describe('toSafeReturnPath', () => {
  test.each([
    ['/my/products/new', '/my/products/new'],
    [
      '/settings/account?tab=email&page=2#top',
      '/settings/account?tab=email&page=2#top',
    ],
    ['/', '/'],
    ['/p/pitch-notes/../pitch-notes', '/p/pitch-notes'],
  ])('同じサイト内のパス「%s」は「%s」を戻り先にする', (value, expected) => {
    expect(toSafeReturnPath(value)).toBe(expected);
  });

  test.each([
    ['省略', undefined],
    ['空文字列', ''],
    ['相対パス', 'my/products'],
    ['プロトコル相対のURL', '//evil.example/path'],
    ['バックスラッシュで始まるプロトコル相対のURL', '/\\evil.example/path'],
    ['絶対URL', 'https://evil.example/path'],
    ['スキームの付いた値', 'javascript:alert(1)'],
    ['タブを挟んだプロトコル相対のURL', '/\t/evil.example/path'],
    ['タブを除くと空のホストになる値', '/\t/'],
    ['改行を除くと不正な符号化のホストになる値', '/\n/%'],
    ['タブを除くと空白を含むホストになる値', '/\t/a b'],
    ['タブを除くと閉じていないIPv6のホストになる値', '/\t/['],
    ['タブを除くと数字でないポートのホストになる値', '/\t/a:b'],
    ['復帰を除くと空のホストになる値', '/\r\\'],
    ['改行を挟んだプロトコル相対のURL', '/\n/evil.example/path'],
    ['ドットセグメントの正規化でプロトコル相対になるURL', '/.//evil.example/x'],
    [
      '親を指すセグメントの正規化でプロトコル相対になるURL',
      '/..//evil.example',
    ],
    [
      '符号化したドットセグメントの正規化でプロトコル相対になるURL',
      '/%2e//evil.example',
    ],
    [
      '途中の親を指すセグメントの正規化でプロトコル相対になるURL',
      '/a/..//evil.example',
    ],
    [
      'ドットセグメントとバックスラッシュの正規化でプロトコル相対になるURL',
      '/./\\evil.example',
    ],
    [
      'タブを挟んだドットセグメントの正規化でプロトコル相対になるURL',
      '/\t./\t/evil.example',
    ],
    [
      '大文字の符号化したドットセグメントの正規化でプロトコル相対になるURL',
      '/%2E%2E//evil.example',
    ],
    ['ドットセグメントの後のバックスラッシュ2つ', '/x/../\\\\evil.example'],
  ])('%sはトップページを戻り先にする', (_name, value) => {
    expect(toSafeReturnPath(value)).toBe('/');
  });
});

describe('toSafeReturnPathの正規化の後の形', () => {
  test.each([
    ['符号化したスラッシュ', '/%2f%2fevil.example'],
    ['符号化したバックスラッシュ', '/%5c%5cevil.example'],
    ['ドットセグメントの後の符号化したスラッシュ', '/./%2fevil.example'],
    ['全角のスラッシュ', '/／evil.example'],
  ])(
    '%sは、別のサイトへのURLにならない同じサイト内のパスとして返す',
    (_name, value) => {
      const result = toSafeReturnPath(value);

      expect(result.startsWith('/')).toBe(true);
      expect(result.startsWith('//')).toBe(false);
      expect(result.startsWith('/\\')).toBe(false);
      expect(new URL(result, 'https://client.example').origin).toBe(
        'https://client.example',
      );
    },
  );
});

describe('toLoginSearch', () => {
  test('文字列の戻り先だけを検索パラメータに残す', () => {
    expect(toLoginSearch({ redirect: '/my/products/new', page: 2 })).toEqual({
      redirect: '/my/products/new',
    });
  });

  test.each([
    ['無い', {}],
    ['数値', { redirect: 123 }],
    ['配列', { redirect: ['/a', '/b'] }],
  ])('戻り先が%s時は戻り先を持たない', (_name, search) => {
    expect(toLoginSearch(search)).toEqual({});
  });
});
