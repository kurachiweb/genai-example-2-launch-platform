import { describe, expect, test } from 'bun:test';

import {
  checkExternalUrl,
  EXTERNAL_URL_MAX_LENGTH,
  externalUrlHost,
} from './external-url.ts';

const urlOfLength = (length: number): string => {
  const prefix = 'https://a.example/';
  return `${prefix}${'a'.repeat(length - prefix.length)}`;
};

describe('EXTERNAL_URL_MAX_LENGTH', () => {
  test('2,048である', () => {
    expect(EXTERNAL_URL_MAX_LENGTH).toBe(2048);
  });
});

describe('checkExternalUrl', () => {
  test.each([
    ['https', 'https://a.example'],
    ['http', 'http://a.example'],
    ['パスとクエリとフラグメント付き', 'https://a.example/p/q?x=1&y=2#top'],
    ['ポート付き', 'https://a.example:8443/'],
    ['大文字のスキーム', 'HTTPS://a.example'],
    ['大小混在のスキーム', 'Http://a.example'],
    ['国際化ドメイン名', 'https://例え.example/'],
    ['前後に空白', '  https://a.example/  '],
    ['前後に全角空白', '　https://a.example　'],
  ])('%sの絶対URLを受け付ける', (_, value) => {
    expect(checkExternalUrl(value)).toBe('ok');
  });

  test('2,048文字を受け付ける', () => {
    const value = urlOfLength(2048);
    expect(value).toHaveLength(2048);
    expect(checkExternalUrl(value)).toBe('ok');
  });

  test('2,049文字をtoo-longと判定する', () => {
    const value = urlOfLength(2049);
    expect(value).toHaveLength(2049);
    expect(checkExternalUrl(value)).toBe('too-long');
  });

  test('前後の空白は文字数に数えない', () => {
    expect(checkExternalUrl(`  ${urlOfLength(2048)}  `)).toBe('ok');
  });

  test.each([
    ['空文字列', ''],
    ['空白だけ', ' 　\t\n'],
  ])('%sをemptyと判定する', (_, value) => {
    expect(checkExternalUrl(value)).toBe('empty');
  });

  test.each([
    ['javascript:', 'javascript:alert(1)'],
    ['大文字のJavaScript:', 'JavaScript:alert(1)'],
    ['data:', 'data:text/html,<script>alert(1)</script>'],
    ['mailto:', 'mailto:a@a.example'],
    ['ftp://', 'ftp://a.example/file'],
    ['file://', 'file:///etc/passwd'],
    ['javascript://', 'javascript://a.example/%0aalert(1)'],
    ['tel:', 'tel:+81000000000'],
  ])('%sのスキームをdisallowed-schemeと判定する', (_, value) => {
    expect(checkExternalUrl(value)).toBe('disallowed-scheme');
  });

  test.each([
    ['相対パス', 'a.example/path'],
    ['ルートからの相対パス', '/path'],
    ['プロトコル相対URL', '//a.example/path'],
    ['ドット付きの相対パス', './path'],
    ['クエリだけ', '?x=1'],
    ['フラグメントだけ', '#top'],
    ['スキームの直後に//の無いhttps', 'https:a.example'],
    ['スキームの直後に/が1つのhttps', 'https:/a.example'],
    ['スキームの直後に//の無いhttp', 'http:a.example'],
    ['大文字でスキームの直後に//の無い値', 'HTTPS:a.example'],
    ['バックスラッシュのhttps', 'https:\\\\a.example'],
    ['ホストの無いhttps', 'https://'],
    ['ホストに空白を含む', 'https://a b.example/'],
    ['途中の改行', 'https://a.exa\nmple/'],
    ['途中のタブ', 'https://a.exa\tmple/'],
  ])('%sをnot-absoluteと判定する', (_, value) => {
    expect(checkExternalUrl(value)).toBe('not-absolute');
  });

  test('文字数の違反を絶対URLの違反より先に示す', () => {
    expect(checkExternalUrl(`javascript:${'a'.repeat(2048)}`)).toBe('too-long');
  });
});

describe('externalUrlHost', () => {
  test('ホスト名を返す', () => {
    expect(externalUrlHost('https://www.a.example:8443/p?q=1')).toBe(
      'www.a.example',
    );
  });

  test('前後の空白を除いて解析する', () => {
    expect(externalUrlHost('  http://a.example/  ')).toBe('a.example');
  });

  test('ホスト名は小文字で返す', () => {
    expect(externalUrlHost('HTTPS://A.Example/')).toBe('a.example');
  });

  test.each([
    ['空文字列', ''],
    ['相対URL', '/path'],
    ['スキームの直後に//の無い値', 'https:a.example'],
    ['許可しないスキーム', 'javascript:alert(1)'],
    ['URLとして解析できない値', 'https://'],
  ])('%sは空文字列を返す', (_, value) => {
    expect(externalUrlHost(value)).toBe('');
  });
});
