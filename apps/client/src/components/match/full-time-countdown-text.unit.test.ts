import { describe, expect, test } from 'bun:test';

import {
  COUNTDOWN_LABEL,
  COUNTDOWN_PLACEHOLDER,
  countdownDigitsOf,
  countdownReadingOf,
} from './full-time-countdown-text.ts';

const MINUTE_S = 60;
const HOUR_S = 60 * MINUTE_S;

describe('countdownDigitsOf', () => {
  test.each([
    [12 * HOUR_S + 34 * MINUTE_S + 56, '12:34:56'],
    [34 * MINUTE_S + 5, '00:34:05'],
    [42, '00:00:42'],
    [0, '00:00:00'],
  ])('残り%i秒を時:分:秒の2桁ずつで「%s」にする', (seconds, expected) => {
    expect(countdownDigitsOf(seconds)).toBe(expected);
  });

  test('負の残りは0として扱う', () => {
    expect(countdownDigitsOf(-3)).toBe('00:00:00');
  });
});

describe('countdownReadingOf', () => {
  test.each([
    [12 * HOUR_S + 34 * MINUTE_S + 56, 'フルタイムまであと12時間34分'],
    [HOUR_S, 'フルタイムまであと1時間0分'],
    [HOUR_S - 1, 'フルタイムまであと59分'],
    [34 * MINUTE_S + 59, 'フルタイムまであと34分'],
    [MINUTE_S, 'フルタイムまであと1分'],
    [MINUTE_S - 1, 'フルタイムまであと1分未満'],
    [0, 'フルタイムまであと1分未満'],
  ])('残り%i秒を分単位の「%s」にする', (seconds, expected) => {
    expect(countdownReadingOf(seconds)).toBe(expected);
  });
});

describe('文言', () => {
  test('ラベルと時刻が分かる前の表示', () => {
    expect(COUNTDOWN_LABEL).toBe('フルタイムまであと');
    expect(COUNTDOWN_PLACEHOLDER).toBe('--:--:--');
  });
});
