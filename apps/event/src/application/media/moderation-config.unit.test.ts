import { describe, expect, test } from 'bun:test';

import {
  MODERATION_CATEGORIES,
  parseModerationConfig,
} from './moderation-config.ts';

const ALL_CATEGORIES = MODERATION_CATEGORIES.join(',');

describe('MODERATION_CATEGORIES', () => {
  test('判定サービスの最上位の10カテゴリを持つ', () => {
    expect(MODERATION_CATEGORIES).toEqual([
      'Explicit',
      'Non-Explicit Nudity of Intimate parts and Kissing',
      'Swimwear or Underwear',
      'Violence',
      'Visually Disturbing',
      'Drugs & Tobacco',
      'Alcohol',
      'Rude Gestures',
      'Gambling',
      'Hate Symbols',
    ]);
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(MODERATION_CATEGORIES)).toBe(true);
  });
});

describe('parseModerationConfig', () => {
  test('初期値(全カテゴリ・60)を解析する', () => {
    expect(
      parseModerationConfig({
        MODERATION_MIN_CONFIDENCE: '60',
        MODERATION_BLOCKED_CATEGORIES: ALL_CATEGORIES,
      }),
    ).toEqual({
      minConfidence: 60,
      blockedCategories: [...MODERATION_CATEGORIES],
    });
  });

  test.each([
    ['0', 0],
    ['100', 100],
    ['72.5', 72.5],
  ])('閾値%sを数値%dとして受け付ける', (value, expected) => {
    expect(
      parseModerationConfig({
        MODERATION_MIN_CONFIDENCE: value,
        MODERATION_BLOCKED_CATEGORIES: 'Explicit',
      }).minConfidence,
    ).toBe(expected);
  });

  test.each(['', ' ', '-1', '100.1', '101', 'abc', '60%', '1e1', ' 60', '.5'])(
    '閾値%pは0〜100の数値ではないため失敗する',
    (value) => {
      expect(() =>
        parseModerationConfig({
          MODERATION_MIN_CONFIDENCE: value,
          MODERATION_BLOCKED_CATEGORIES: 'Explicit',
        }),
      ).toThrow('MODERATION_MIN_CONFIDENCE');
    },
  );

  test('カテゴリの部分集合を書かれた順に受け付け、区切りの前後の空白を除く', () => {
    expect(
      parseModerationConfig({
        MODERATION_MIN_CONFIDENCE: '60',
        MODERATION_BLOCKED_CATEGORIES: 'Violence, Drugs & Tobacco ,Explicit',
      }).blockedCategories,
    ).toEqual(['Violence', 'Drugs & Tobacco', 'Explicit']);
  });

  test.each([
    ['全10カテゴリに無い名前', 'Explicit,Weapons'],
    ['大文字小文字の違う名前', 'explicit'],
    ['空の項目', 'Explicit,,Violence'],
    ['重複した項目', 'Explicit,Explicit'],
    ['空の値', ''],
  ])('カテゴリに%sを含むと失敗する', (_case, value) => {
    expect(() =>
      parseModerationConfig({
        MODERATION_MIN_CONFIDENCE: '60',
        MODERATION_BLOCKED_CATEGORIES: value,
      }),
    ).toThrow('MODERATION_BLOCKED_CATEGORIES');
  });

  test('解析の結果は実行時に書き換えられない', () => {
    const config = parseModerationConfig({
      MODERATION_MIN_CONFIDENCE: '60',
      MODERATION_BLOCKED_CATEGORIES: 'Explicit',
    });

    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.blockedCategories)).toBe(true);
  });
});
