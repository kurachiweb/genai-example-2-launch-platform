import { describe, expect, test } from 'bun:test';

import { trimWhiteSpace } from './white-space.ts';

const LONG_RUN_LENGTH = 20_000;

const MAX_ELAPSED_MILLISECONDS = 50;

const LONG_RUN = ' '.repeat(LONG_RUN_LENGTH);

describe('trimWhiteSpace', () => {
  test.each([
    ['半角スペース', '  見出し  '],
    ['全角空白', '\u3000見出し\u3000'],
    ['改行・タブ・CR', '\r\n\t見出し\t\r\n'],
    ['NEL(U+0085)とノーブレークスペース', '\u0085\u00a0見出し\u00a0\u0085'],
    ['行区切りと段落区切り', '\u2028見出し\u2029'],
  ])('前後の%sを除く', (_, text) => {
    expect(trimWhiteSpace(text)).toBe('見出し');
  });

  test('途中の空白を残す', () => {
    expect(trimWhiteSpace(' a \u3000\t b ')).toBe('a \u3000\t b');
  });

  test('U+FEFFを空白として扱わない', () => {
    expect(trimWhiteSpace('\ufeffa\ufeff')).toBe('\ufeffa\ufeff');
  });

  test('前後がサロゲートペアの文字なら除かない', () => {
    expect(trimWhiteSpace(' 🚀a🚀 ')).toBe('🚀a🚀');
  });

  test.each([
    ['空文字列', ''],
    ['空白だけ', ' \u3000\n\t\u0085'],
  ])('%sを空文字列にする', (_, text) => {
    expect(trimWhiteSpace(text)).toBe('');
  });

  test.each([
    ['途中', `a${LONG_RUN}b`, `a${LONG_RUN}b`],
    ['前後', `${LONG_RUN}a${LONG_RUN}`, 'a'],
  ])(
    '%sに長い空白の並びがあっても線形の時間で処理する',
    (_, text, expected) => {
      const startedAt = performance.now();
      const trimmed = trimWhiteSpace(text);
      const elapsed = performance.now() - startedAt;

      expect(trimmed).toBe(expected);
      expect(elapsed).toBeLessThan(MAX_ELAPSED_MILLISECONDS);
    },
  );
});
