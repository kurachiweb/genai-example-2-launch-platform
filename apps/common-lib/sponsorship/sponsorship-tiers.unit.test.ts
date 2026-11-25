import { describe, expect, test } from 'bun:test';

import {
  SPONSORSHIP_PRICE_LOOKUP_KEYS,
  SPONSORSHIP_TIERS,
  SPONSORSHIP_TIER_LABELS,
  SPONSOR_LABEL_TEXT,
} from './sponsorship-tiers.ts';

describe('SPONSORSHIP_TIERS', () => {
  test('Legend・Gold・Silverの3つを目立つ順に並べる', () => {
    expect(SPONSORSHIP_TIERS).toEqual(['legend', 'gold', 'silver']);
    expect(Object.isFrozen(SPONSORSHIP_TIERS)).toBe(true);
  });
});

describe('SPONSORSHIP_TIER_LABELS', () => {
  test('ティアごとの表示名を持つ', () => {
    expect(SPONSORSHIP_TIER_LABELS).toEqual({
      legend: 'Legend',
      gold: 'Gold',
      silver: 'Silver',
    });
    expect(Object.isFrozen(SPONSORSHIP_TIER_LABELS)).toBe(true);
  });
});

describe('SPONSORSHIP_PRICE_LOOKUP_KEYS', () => {
  test('ティアごとに1日あたりの価格のlookup_keyを持つ', () => {
    expect(SPONSORSHIP_PRICE_LOOKUP_KEYS).toEqual({
      legend: 'sponsorship_legend_daily',
      gold: 'sponsorship_gold_daily',
      silver: 'sponsorship_silver_daily',
    });
    expect(Object.isFrozen(SPONSORSHIP_PRICE_LOOKUP_KEYS)).toBe(true);
  });

  test('lookup_keyはティアの間で重ならない', () => {
    const keys = SPONSORSHIP_TIERS.map(
      (tier) => SPONSORSHIP_PRICE_LOOKUP_KEYS[tier],
    );
    expect(new Set(keys).size).toBe(SPONSORSHIP_TIERS.length);
  });
});

describe('SPONSOR_LABEL_TEXT', () => {
  test('広告に添えるラベルの文言は「スポンサー」', () => {
    expect(SPONSOR_LABEL_TEXT).toBe('スポンサー');
  });
});
