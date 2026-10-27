import { describe, expect, spyOn, test } from 'bun:test';

import {
  DATE_TIME_FORMATS,
  type DateTimeFormatName,
  formatDateTime,
} from './date-time-formats.ts';
import type { DisplayPreferences } from './display-preferences.ts';

const FORMAT_NAMES = Object.keys(DATE_TIME_FORMATS) as DateTimeFormatName[];

const KICKOFF = new Date('2026-01-15T07:40:00.000Z');

const TOKYO_JA: DisplayPreferences = {
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
};

const LOS_ANGELES_JA: DisplayPreferences = {
  timeZone: 'America/Los_Angeles',
  locale: 'ja-JP',
};

const TIME_ZONE_NOTATION =
  /UTC|GMT|PST|PDT|JST|[+-]\d{2}:?\d{2}|太平洋|日本|Pacific|Japan|Los_Angeles|Tokyo/u;

describe('DATE_TIME_FORMATS', () => {
  test('モックアップの7つの書式の名前を持つ', () => {
    expect(FORMAT_NAMES.toSorted()).toEqual([
      'date',
      'dateTime',
      'dateWeekday',
      'longDate',
      'longDateTime',
      'time',
      'yearDate',
    ]);
  });

  test('どの書式もタイムゾーンとタイムゾーン名の指定を含まない', () => {
    for (const name of FORMAT_NAMES) {
      expect(DATE_TIME_FORMATS[name]).not.toHaveProperty('timeZone');
      expect(DATE_TIME_FORMATS[name]).not.toHaveProperty('timeZoneName');
    }
  });
});

describe('formatDateTime', () => {
  test('書式の名前ごとに指定したタイムゾーンとロケールで整形する', () => {
    const expected: Record<DateTimeFormatName, string> = {
      time: '16:40',
      date: '1月15日',
      dateWeekday: '1月15日(木)',
      yearDate: '2026年1月15日',
      longDate: '2026年1月15日(木)',
      dateTime: '1月15日(木) 16:40',
      longDateTime: '2026年1月15日(木) 16:40',
    };

    for (const name of FORMAT_NAMES) {
      expect(formatDateTime(KICKOFF, name, TOKYO_JA)).toBe(expected[name]);
    }
  });

  test('同じ時点でもタイムゾーンが違えば日付と時刻が変わる', () => {
    expect(formatDateTime(KICKOFF, 'longDateTime', LOS_ANGELES_JA)).toBe(
      '2026年1月14日(水) 23:40',
    );
    expect(
      formatDateTime(KICKOFF, 'longDateTime', {
        timeZone: 'UTC',
        locale: 'ja-JP',
      }),
    ).toBe('2026年1月15日(木) 07:40');
  });

  test('ロケールに従った形式で整形する', () => {
    expect(
      formatDateTime(KICKOFF, 'yearDate', {
        timeZone: 'Asia/Tokyo',
        locale: 'en-US',
      }),
    ).toBe('January 15, 2026');
    expect(
      formatDateTime(KICKOFF, 'yearDate', {
        timeZone: 'Asia/Tokyo',
        locale: 'de-DE',
      }),
    ).toBe('15. Januar 2026');
  });

  test('どの書式・ロケールでもUTC-08:00の表記やタイムゾーン名を含まない', () => {
    const locales = ['ja-JP', 'en-US', 'en-GB', 'de-DE', 'fr-FR', 'ko-KR'];
    const timeZones = ['America/Los_Angeles', 'Etc/GMT+8', 'Asia/Tokyo'];

    for (const locale of locales) {
      for (const timeZone of timeZones) {
        for (const name of FORMAT_NAMES) {
          const formatted = formatDateTime(KICKOFF, name, { timeZone, locale });

          expect(formatted).not.toMatch(TIME_ZONE_NOTATION);
        }
      }
    }
  });
});

describe('formatDateTime(整形のオブジェクトの使い回し)', () => {
  test('同じ表示設定のオブジェクトと書式では整形のオブジェクトを1度だけ作る', () => {
    const preferences: DisplayPreferences = { ...TOKYO_JA };
    const constructor = spyOn(Intl, 'DateTimeFormat');
    try {
      formatDateTime(KICKOFF, 'time', preferences);
      formatDateTime(KICKOFF, 'time', preferences);
      formatDateTime(KICKOFF, 'date', preferences);
      formatDateTime(KICKOFF, 'time', { ...TOKYO_JA });

      expect(constructor).toHaveBeenCalledTimes(3);
    } finally {
      constructor.mockRestore();
    }
  });

  test('使い回しても表示設定と書式ごとの整形の結果は変わらない', () => {
    const preferences: DisplayPreferences = { ...TOKYO_JA };

    expect(formatDateTime(KICKOFF, 'time', preferences)).toBe('16:40');
    expect(formatDateTime(KICKOFF, 'yearDate', preferences)).toBe(
      '2026年1月15日',
    );
    expect(formatDateTime(KICKOFF, 'time', preferences)).toBe('16:40');
    expect(formatDateTime(KICKOFF, 'time', LOS_ANGELES_JA)).toBe('23:40');
  });
});
