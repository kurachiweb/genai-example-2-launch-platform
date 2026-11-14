import { describe, expect, expectTypeOf, test } from 'bun:test';

import {
  GENERATED_HANDLE_ALPHABET,
  GENERATED_HANDLE_LENGTH,
} from './handle.ts';

describe('登録時に生成する初期ハンドルの形式', () => {
  test('長さは12文字である', () => {
    expect(GENERATED_HANDLE_LENGTH).toBe(12);
    expectTypeOf<typeof GENERATED_HANDLE_LENGTH>().toEqualTypeOf<12>();
  });

  test('文字種は英小文字と数字の36文字で、重複が無い', () => {
    expect(GENERATED_HANDLE_ALPHABET).toMatch(/^[a-z0-9]{36}$/);
    expect(new Set(GENERATED_HANDLE_ALPHABET).size).toBe(36);
    expectTypeOf<
      typeof GENERATED_HANDLE_ALPHABET
    >().toEqualTypeOf<'abcdefghijklmnopqrstuvwxyz0123456789'>();
  });
});
