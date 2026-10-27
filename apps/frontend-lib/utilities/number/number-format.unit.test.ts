import { describe, expect, spyOn, test } from 'bun:test';

import { formatNumber } from './number-format.ts';

const inLocale = (locale: string) => ({ timeZone: 'UTC', locale });

describe('formatNumber', () => {
  test('ロケールに従った3桁区切りで整形する', () => {
    expect(formatNumber(1234567, inLocale('ja-JP'))).toBe('1,234,567');
    expect(formatNumber(1234567, inLocale('en-US'))).toBe('1,234,567');
    expect(formatNumber(1234567, inLocale('de-DE'))).toBe('1.234.567');
    expect(formatNumber(1234567, inLocale('fr-FR'))).toBe(
      '1\u202f234\u202f567',
    );
  });

  test('ロケールに従った桁のまとまりと小数点で整形する', () => {
    expect(formatNumber(1234567, inLocale('en-IN'))).toBe('12,34,567');
    expect(formatNumber(1234.5, inLocale('de-DE'))).toBe('1.234,5');
  });

  test('3桁に満たない数は区切らない', () => {
    expect(formatNumber(999, inLocale('ja-JP'))).toBe('999');
    expect(formatNumber(0, inLocale('ja-JP'))).toBe('0');
  });

  test('タイムゾーンは整形の結果に影響しない', () => {
    expect(
      formatNumber(1234567, { timeZone: 'Asia/Tokyo', locale: 'de-DE' }),
    ).toBe(formatNumber(1234567, inLocale('de-DE')));
  });

  test('追加の指定を整形に反映する', () => {
    expect(
      formatNumber(9, inLocale('en-US'), {
        style: 'currency',
        currency: 'USD',
        trailingZeroDisplay: 'stripIfInteger',
      }),
    ).toBe('$9');
    expect(
      formatNumber(0.256, inLocale('ja-JP'), {
        style: 'percent',
        maximumFractionDigits: 1,
      }),
    ).toBe('25.6%');
  });
});

describe('formatNumber(整形のオブジェクトの使い回し)', () => {
  test('同じ表示設定のオブジェクトと同じ内容の指定では整形のオブジェクトを1度だけ作る', () => {
    const preferences = inLocale('ja-JP');
    const constructor = spyOn(Intl, 'NumberFormat');
    try {
      formatNumber(1, preferences);
      formatNumber(2, preferences);
      formatNumber(0.1, preferences, { style: 'percent' });
      formatNumber(0.2, preferences, { style: 'percent' });
      formatNumber(3, inLocale('ja-JP'));

      expect(constructor).toHaveBeenCalledTimes(3);
    } finally {
      constructor.mockRestore();
    }
  });

  test('使い回しても指定ごとの整形の結果は変わらない', () => {
    const preferences = inLocale('ja-JP');

    expect(formatNumber(0.5, preferences)).toBe('0.5');
    expect(formatNumber(0.5, preferences, { style: 'percent' })).toBe('50%');
    expect(formatNumber(0.5, preferences)).toBe('0.5');
  });
});
