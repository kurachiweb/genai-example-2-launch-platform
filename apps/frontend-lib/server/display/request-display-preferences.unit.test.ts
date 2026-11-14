import { afterEach, describe, expect, spyOn, test } from 'bun:test';

import {
  FALLBACK_DISPLAY_PREFERENCES,
  supportedLocaleOf,
  supportedTimeZoneOf,
} from '../../utilities/datetime/display-preferences.ts';
import {
  MAX_ACCEPT_LANGUAGE_ENTRIES,
  MAX_ACCEPT_LANGUAGE_LENGTH,
  resolveRequestDisplayPreferences,
} from './request-display-preferences.ts';

const localeOf = (acceptLanguage: string | null): string =>
  resolveRequestDisplayPreferences({ cfTimeZone: 'Asia/Tokyo', acceptLanguage })
    .locale;

const timeZoneOf = (cfTimeZone: unknown): string =>
  resolveRequestDisplayPreferences({ cfTimeZone, acceptLanguage: 'en-US' })
    .timeZone;

afterEach(() => {
  spyOn(Intl.DateTimeFormat, 'supportedLocalesOf').mockRestore();
});

describe('resolveRequestDisplayPreferences', () => {
  describe('タイムゾーン', () => {
    test.each(['Asia/Tokyo', 'America/Los_Angeles', 'Europe/Berlin', 'UTC'])(
      '接続元のタイムゾーン%sを採用する',
      (timeZone) => {
        expect(timeZoneOf(timeZone)).toBe(timeZone);
      },
    );

    test('大文字小文字の違うタイムゾーン名は正規の表記にする', () => {
      expect(timeZoneOf('asia/tokyo')).toBe('Asia/Tokyo');
    });

    test.each([
      ['存在しない名前', 'Mars/Olympus_Mons'],
      ['空文字列', ''],
      ['undefined', undefined],
      ['null', null],
      ['数値', 9],
      ['オブジェクト', { timeZone: 'Asia/Tokyo' }],
    ])('不正な値(%s)はUTCにし、ロケールは採用する', (_label, cfTimeZone) => {
      expect(
        resolveRequestDisplayPreferences({
          cfTimeZone,
          acceptLanguage: 'en-US',
        }),
      ).toEqual({ timeZone: 'UTC', locale: 'en-US' });
    });
  });

  describe('ロケール', () => {
    test('1つだけの言語タグを採用する', () => {
      expect(localeOf('en-US')).toBe('en-US');
    });

    test('大文字小文字の違う言語タグは正規化する', () => {
      expect(localeOf('EN-us')).toBe('en-US');
    });

    test('q値の無い言語タグをq=1として最も優先する', () => {
      expect(localeOf('fr-FR;q=0.9, ja')).toBe('ja');
    });

    test('q値の降順に並べて最初の言語タグを使う', () => {
      expect(localeOf('en-US;q=0.5, de-DE;q=0.8, fr-FR;q=0.7')).toBe('de-DE');
    });

    test('q値が同じならヘッダーの順を保つ', () => {
      expect(localeOf('fr-FR;q=0.8, de-DE;q=0.8')).toBe('fr-FR');
    });

    test('ブラウザが送る典型的な値を解釈する', () => {
      expect(localeOf('ja,en-US;q=0.9,en;q=0.8')).toBe('ja');
    });

    test('q=0の言語タグは使わない', () => {
      expect(localeOf('de-DE;q=0, en-US;q=0.1')).toBe('en-US');
      expect(localeOf('de-DE;q=0.000')).toBe('ja-JP');
    });

    test('ワイルドカードは使わず、次の言語タグを使う', () => {
      expect(localeOf('*, en-US;q=0.5')).toBe('en-US');
      expect(localeOf('*')).toBe('ja-JP');
    });

    test('対応していない言語タグを除き、次の言語タグを使う', () => {
      expect(localeOf('xx-YY, en-US;q=0.5')).toBe('en-US');
    });

    test.each([
      ['空白を含む', 'not a locale'],
      ['下線で区切った', 'en_US'],
      ['9文字以上の部分を持つ', 'abcdefghi'],
      ['拡張の部分だけの', 'en-x'],
      ['記号を含む', 'en-US<script>'],
    ])('解釈できない言語タグ(%s)を除き、次の言語タグを使う', (_label, tag) => {
      expect(localeOf(`${tag}, en-US;q=0.5`)).toBe('en-US');
    });

    test.each([
      ['数値でない', 'q=abc'],
      ['1を超える', 'q=1.5'],
      ['負の', 'q=-1'],
      ['小数部が4桁以上の', 'q=0.1234'],
      ['空の', 'q='],
      ['q以外の引数の', 'level=1'],
    ])('q値が不正(%s)な要素を除く', (_label, parameter) => {
      expect(localeOf(`de-DE;${parameter}, en-US;q=0.5`)).toBe('en-US');
    });

    test('q値の前後の空白と大文字のQを受け付ける', () => {
      expect(localeOf('en-US ; Q=0.5 ,\tde-DE\t;\tq=0.9')).toBe('de-DE');
    });

    test('上限のq値1.000と小数部3桁のq値を受け付ける', () => {
      expect(localeOf('en-US;q=0.999, de-DE;q=1.000')).toBe('de-DE');
    });

    test('空の要素を読み飛ばす', () => {
      expect(localeOf(' , ,en-US,')).toBe('en-US');
    });

    test('重複した言語タグは最も高いq値で扱う', () => {
      expect(localeOf('de-DE;q=0.1, en-US;q=0.5, de-DE;q=0.9')).toBe('de-DE');
    });

    test.each([
      ['null', null],
      ['空文字列', ''],
      ['空白だけ', '   '],
      ['対応していない言語タグだけ', 'xx-YY, zz'],
      ['不正な値だけ', ';;;,,,==='],
    ])(
      '得られない(%s)ならja-JPにし、タイムゾーンは採用する',
      (_label, acceptLanguage) => {
        expect(
          resolveRequestDisplayPreferences({
            cfTimeZone: 'Asia/Tokyo',
            acceptLanguage,
          }),
        ).toEqual({ timeZone: 'Asia/Tokyo', locale: 'ja-JP' });
      },
    );
  });

  describe('攻撃的な入力', () => {
    test('上限の長さを超えた部分は読まず、途中で切れた要素も使わない', () => {
      const header = `${'x'.repeat(MAX_ACCEPT_LANGUAGE_LENGTH - 3)},de-DE,en-US`;

      expect(header.slice(0, MAX_ACCEPT_LANGUAGE_LENGTH).endsWith(',de')).toBe(
        true,
      );
      expect(localeOf(header)).toBe('ja-JP');
    });

    test('上限の長さの直後が区切りなら、上限までの最後の要素を使う', () => {
      const header = `${'x'.repeat(MAX_ACCEPT_LANGUAGE_LENGTH - 6)},en-US,de-DE`;

      expect(
        header.slice(0, MAX_ACCEPT_LANGUAGE_LENGTH).endsWith(',en-US'),
      ).toBe(true);
      expect(localeOf(header)).toBe('en-US');
    });

    test('上限の長さちょうどの値はすべて読む', () => {
      const tail = ',en-US';
      const header = `${'x'.repeat(MAX_ACCEPT_LANGUAGE_LENGTH - tail.length)}${tail}`;

      expect(header).toHaveLength(MAX_ACCEPT_LANGUAGE_LENGTH);
      expect(localeOf(header)).toBe('en-US');
    });

    test('上限の個数を超えた要素は読まない', () => {
      const unsupported = Array.from(
        { length: MAX_ACCEPT_LANGUAGE_ENTRIES },
        () => 'xx',
      );

      expect(localeOf([...unsupported, 'en-US'].join(','))).toBe('ja-JP');
      expect(localeOf([...unsupported.slice(1), 'en-US'].join(','))).toBe(
        'en-US',
      );
    });

    test('非常に長い値でも言語タグの検証の回数は上限の個数までにとどまる', () => {
      const supportedLocalesOf = spyOn(
        Intl.DateTimeFormat,
        'supportedLocalesOf',
      );
      const header = Array.from(
        { length: 100_000 },
        (_, index) => `zz-${(index + 46_656).toString(36)}`,
      ).join(',');

      expect(localeOf(header)).toBe('ja-JP');
      expect(supportedLocalesOf.mock.calls.length).toBeLessThanOrEqual(
        MAX_ACCEPT_LANGUAGE_ENTRIES,
      );
    });

    test('同じ言語タグの繰り返しは1回だけ検証する', () => {
      const supportedLocalesOf = spyOn(
        Intl.DateTimeFormat,
        'supportedLocalesOf',
      );

      expect(localeOf('xx-YY,xx-YY;q=0.9,XX-yy;q=0.8')).toBe('ja-JP');
      expect(supportedLocalesOf).toHaveBeenCalledTimes(1);
    });
  });

  describe('推定の結果', () => {
    test('どちらも得られなければUTCとja-JPにする', () => {
      expect(
        resolveRequestDisplayPreferences({
          cfTimeZone: undefined,
          acceptLanguage: null,
        }),
      ).toEqual(FALLBACK_DISPLAY_PREFERENCES);
    });

    test.each([
      [undefined, null],
      ['Asia/Tokyo', 'ja,en-US;q=0.9'],
      ['asia/tokyo', 'EN-us'],
      ['Mars/Olympus_Mons', 'xx-YY'],
      [42, '*'],
      ['Europe/Berlin', 'zh-Hant-TW;q=0.5, de;q=0.4'],
      ['America/New_York', 'i-klingon, en-GB;q=0.1'],
    ])(
      'いつもIntlで使えるタイムゾーンとロケールになる(%p・%p)',
      (cfTimeZone, acceptLanguage) => {
        const { timeZone, locale } = resolveRequestDisplayPreferences({
          cfTimeZone,
          acceptLanguage,
        });

        expect(supportedTimeZoneOf(timeZone)).toBe(timeZone);
        expect(supportedLocaleOf(locale)).toBe(locale);
        expect(() =>
          new Intl.DateTimeFormat(locale, { timeZone }).format(new Date(0)),
        ).not.toThrow();
      },
    );
  });
});
