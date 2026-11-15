import { describe, expect, test } from 'bun:test';

import { normalizeAnchorFragment, slugifyHeading } from './heading-slug.ts';

const LONG_RUN_LENGTH = 20_000;

const MAX_ELAPSED_MILLISECONDS = 50;

describe('slugifyHeading', () => {
  test('途中に長い空白の並びがある見出しを線形の時間で変換する', () => {
    const startedAt = performance.now();
    const slug = slugifyHeading(`a${' '.repeat(LONG_RUN_LENGTH)}b`);
    const elapsed = performance.now() - startedAt;

    expect(slug).toBe(`a${'-'.repeat(LONG_RUN_LENGTH)}b`);
    expect(elapsed).toBeLessThan(MAX_ELAPSED_MILLISECONDS);
  });

  test('日本語・空白・英字・記号を含む見出しを規則どおりに変換する', () => {
    expect(slugifyHeading('概要 Hello World!')).toBe(
      '%E6%A6%82%E8%A6%81-hello-world%21',
    );
  });

  test.each([
    ['ASCIIの英字を小文字にする', 'ABC xyz', 'abc-xyz'],
    ['数字・ハイフン・アンダースコアを維持する', '2026-10_30', '2026-10_30'],
    ['連続した空白をそれぞれハイフンにする', 'a  b', 'a--b'],
    ['前後の空白を除く', '  Setup  ', 'setup'],
    ['前後の全角空白と改行を除く', '\u3000\nSetup\t\u3000', 'setup'],
    ['ピリオドをエンコードする', 'v1.2', 'v1%2E2'],
    [
      'encodeURIComponentが残す記号もエンコードする',
      "!*()~'",
      '%21%2A%28%29%7E%27',
    ],
    ['パーセント記号をエンコードする', '100%', '100%25'],
    ['ASCII以外のラテン文字は小文字にせずエンコードする', 'Äb', '%C3%84b'],
    ['全角英字は正規化せずエンコードする', 'Ａ', '%EF%BC%A1'],
    ['サロゲートペアの文字を4バイトでエンコードする', '🚀', '%F0%9F%9A%80'],
    ['途中のタブをエンコードする', 'a\tb', 'a%09b'],
    ['途中の全角空白をエンコードする', 'a\u3000b', 'a%E3%80%80b'],
    [
      '孤立したサロゲートを置換文字としてエンコードする',
      'a\ud83d',
      'a%EF%BF%BD',
    ],
  ])('%s', (_, text, expected) => {
    expect(slugifyHeading(text)).toBe(expected);
  });

  test.each([
    ['空文字列', ''],
    ['空白だけ', ' \t\u3000\n'],
  ])('%sの見出しは既定値のheadingにする', (_, text) => {
    expect(slugifyHeading(text)).toBe('heading');
  });

  test('結果は英小文字・数字・ハイフン・アンダースコアと大文字の%XXだけで構成される', () => {
    const slug = slugifyHeading('Ünïcödé 見出し <script> & "quote" #1');

    expect(slug).toMatch(/^(?:[a-z0-9_-]|%[0-9A-F]{2})+$/u);
  });
});

describe('normalizeAnchorFragment', () => {
  test.each([
    [
      'エンコード済みの日本語と記号を含むフラグメント',
      '%E6%A6%82%E8%A6%81-hello-world!',
    ],
    ['エンコードしていない日本語のフラグメント', '概要-hello-world!'],
    [
      '小文字のエンコードを含むフラグメント',
      '%e6%a6%82%e8%a6%81-Hello-World%21',
    ],
  ])('%sを見出しのIDと同じスラッグにする', (_, fragment) => {
    expect(normalizeAnchorFragment(fragment)).toBe(
      '%E6%A6%82%E8%A6%81-hello-world%21',
    );
  });

  test('英字の大文字を小文字にする', () => {
    expect(normalizeAnchorFragment('Getting-Started')).toBe('getting-started');
  });

  test('デコードした空白をハイフンにし、前後の空白を除く', () => {
    expect(normalizeAnchorFragment('%20Hello%20World%20')).toBe('hello-world');
  });

  test.each([
    ['途中で切れたエンコード', '%E6%A6', '%25e6%25a6'],
    ['16進数でないエンコード', '100%zz', '100%25zz'],
    ['UTF-8として不正なバイト列', '%ED%A0%80a', '%25ed%25a0%2580a'],
  ])('デコードできない%sはそのまま変換する', (_, fragment, expected) => {
    expect(normalizeAnchorFragment(fragment)).toBe(expected);
  });

  test('空のフラグメントは既定値のheadingにする', () => {
    expect(normalizeAnchorFragment('')).toBe('heading');
  });

  test.each([
    '概要 Hello World!',
    'v1.2 リリースノート',
    '100% & more',
    '🚀 Launch',
    '',
  ])('見出し「%s」のスラッグを渡すと同じスラッグを返す', (heading) => {
    const slug = slugifyHeading(heading);

    expect(normalizeAnchorFragment(slug)).toBe(slug);
  });
});
