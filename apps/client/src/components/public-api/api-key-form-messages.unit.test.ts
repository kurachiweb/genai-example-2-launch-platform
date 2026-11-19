import { describe, expect, test } from 'bun:test';

import { apiKeyNameCounterOf } from './api-key-form-messages.ts';

describe('apiKeyNameCounterOf', () => {
  test('名前の文字数と上限の文字数を斜線で区切って示す', () => {
    expect(apiKeyNameCounterOf(12)).toBe('12/50');
  });

  test('上限を超えた文字数もそのまま示す', () => {
    expect(apiKeyNameCounterOf(51)).toBe('51/50');
  });
});
