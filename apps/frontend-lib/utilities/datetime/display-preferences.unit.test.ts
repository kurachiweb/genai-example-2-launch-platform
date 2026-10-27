import { describe, expect, test } from 'bun:test';

import {
  FALLBACK_DISPLAY_PREFERENCES,
  resolveBrowserDisplayPreferences,
  supportedLocaleOf,
  supportedTimeZoneOf,
  toDisplayPreferences,
} from './display-preferences.ts';

describe('FALLBACK_DISPLAY_PREFERENCES', () => {
  test('代替の表示設定はUTCとja-JPである', () => {
    expect(FALLBACK_DISPLAY_PREFERENCES).toEqual({
      timeZone: 'UTC',
      locale: 'ja-JP',
    });
  });
});

describe('supportedTimeZoneOf', () => {
  test('Intlで使えるタイムゾーン名をそのまま返す', () => {
    expect(supportedTimeZoneOf('Asia/Tokyo')).toBe('Asia/Tokyo');
    expect(supportedTimeZoneOf('America/Los_Angeles')).toBe(
      'America/Los_Angeles',
    );
    expect(supportedTimeZoneOf('UTC')).toBe('UTC');
  });

  test('大文字小文字の違うタイムゾーン名は正規の表記にする', () => {
    expect(supportedTimeZoneOf('asia/tokyo')).toBe('Asia/Tokyo');
  });

  test('Intlで使えない値はnullにする', () => {
    const invalidValues: readonly unknown[] = [
      'Mars/Olympus_Mons',
      '',
      undefined,
      null,
      9,
      { timeZone: 'Asia/Tokyo' },
    ];

    for (const value of invalidValues) {
      expect(supportedTimeZoneOf(value)).toBeNull();
    }
  });
});

describe('supportedLocaleOf', () => {
  test('対応している言語タグを正規化して返す', () => {
    expect(supportedLocaleOf('ja-JP')).toBe('ja-JP');
    expect(supportedLocaleOf('EN-us')).toBe('en-US');
  });

  test('解釈できない言語タグや文字列でない値はnullにする', () => {
    const invalidValues: readonly unknown[] = [
      'not a locale',
      '',
      '*',
      undefined,
      null,
      1,
      ['ja-JP'],
    ];

    for (const value of invalidValues) {
      expect(supportedLocaleOf(value)).toBeNull();
    }
  });

  test('対応していない言語の言語タグはnullにする', () => {
    expect(supportedLocaleOf('xx-YY')).toBeNull();
  });
});

describe('toDisplayPreferences', () => {
  test('使えるタイムゾーンとロケールはそのまま採用する', () => {
    expect(
      toDisplayPreferences({ timeZone: 'Europe/Berlin', locale: 'de-DE' }),
    ).toEqual({ timeZone: 'Europe/Berlin', locale: 'de-DE' });
  });

  test('タイムゾーンが使えなければUTCにし、ロケールは採用する', () => {
    expect(
      toDisplayPreferences({ timeZone: 'Invalid/Zone', locale: 'en-US' }),
    ).toEqual({ timeZone: 'UTC', locale: 'en-US' });
  });

  test('ロケールが使えなければja-JPにし、タイムゾーンは採用する', () => {
    expect(
      toDisplayPreferences({ timeZone: 'Asia/Tokyo', locale: undefined }),
    ).toEqual({ timeZone: 'Asia/Tokyo', locale: 'ja-JP' });
  });

  test('どちらも得られなければ代替の表示設定にする', () => {
    expect(toDisplayPreferences({ timeZone: null, locale: '' })).toEqual(
      FALLBACK_DISPLAY_PREFERENCES,
    );
  });
});

describe('resolveBrowserDisplayPreferences', () => {
  test('実行環境のIntlが解決したタイムゾーンとロケールを返す', () => {
    const resolved = new Intl.DateTimeFormat().resolvedOptions();

    expect(resolveBrowserDisplayPreferences()).toEqual(
      toDisplayPreferences({
        timeZone: resolved.timeZone,
        locale: resolved.locale,
      }),
    );
  });

  test('返す値はIntlでそのまま使える', () => {
    const preferences = resolveBrowserDisplayPreferences();

    expect(supportedTimeZoneOf(preferences.timeZone)).toBe(
      preferences.timeZone,
    );
    expect(supportedLocaleOf(preferences.locale)).toBe(preferences.locale);
  });
});

describe('supportedLocaleOf(拡張の除去)', () => {
  test('Unicode拡張と私用の部分を落とした言語タグにする', () => {
    expect(supportedLocaleOf('ja-JP-u-ca-japanese')).toBe('ja-JP');
    expect(supportedLocaleOf('en-US-u-nu-arab')).toBe('en-US');
    expect(supportedLocaleOf('en-US-x-private')).toBe('en-US');
    expect(supportedLocaleOf('de-DE-u-co-phonebk-x-foo')).toBe('de-DE');
  });

  test('拡張を持つロケールのブラウザの値も拡張を落として採用する', () => {
    expect(
      toDisplayPreferences({
        timeZone: 'Asia/Tokyo',
        locale: 'ja-JP-u-ca-japanese-hc-h12',
      }),
    ).toEqual({ timeZone: 'Asia/Tokyo', locale: 'ja-JP' });
  });
});
