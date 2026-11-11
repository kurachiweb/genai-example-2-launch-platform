import { describe, expect, test } from 'bun:test';

import {
  formatCount,
  LENGTH_WITHIN_LIMIT_ANNOUNCEMENT,
  lengthOverLimitAnnouncement,
} from './length-limit-messages.ts';

describe('文字数の上限の文言', () => {
  test('文字数は利用者のロケールによらず日本語の3桁区切りで示す', () => {
    expect(formatCount(2000)).toBe('2,000');
    expect(formatCount(50)).toBe('50');
  });

  test('文字数の超過の読み上げは上限を3桁区切りで示し、戻りの読み上げは上限の値を含まない', () => {
    expect(lengthOverLimitAnnouncement(2000)).toBe(
      '文字数が上限の2,000文字を超えています。',
    );
    expect(lengthOverLimitAnnouncement(50)).toBe(
      '文字数が上限の50文字を超えています。',
    );
    expect(LENGTH_WITHIN_LIMIT_ANNOUNCEMENT).toBe(
      '文字数が上限以内に戻りました。',
    );
  });

  test('読み上げの文言は句点で終わる', () => {
    for (const sentence of [
      lengthOverLimitAnnouncement(2000),
      LENGTH_WITHIN_LIMIT_ANNOUNCEMENT,
    ]) {
      expect(sentence).toMatch(/。$/u);
    }
  });
});
