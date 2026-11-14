import { describe, expect, test } from 'bun:test';

import { formatElapsed, formatRemaining } from './relative-time.ts';

const NOW = new Date('2026-01-15T07:40:00.000Z');

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const before = (ms: number): Date => new Date(NOW.getTime() - ms);
const after = (ms: number): Date => new Date(NOW.getTime() + ms);

describe('formatElapsed', () => {
  test('1分未満は「たった今」にする', () => {
    expect(formatElapsed(NOW, NOW)).toBe('たった今');
    expect(formatElapsed(before(59 * SECOND_MS), NOW)).toBe('たった今');
  });

  test('現在時刻より後の日時も「たった今」にする', () => {
    expect(formatElapsed(after(5 * MINUTE_MS), NOW)).toBe('たった今');
  });

  test('1時間未満は切り捨てた分で表す', () => {
    expect(formatElapsed(before(MINUTE_MS), NOW)).toBe('1分前');
    expect(formatElapsed(before(HOUR_MS - SECOND_MS), NOW)).toBe('59分前');
  });

  test('1日未満は切り捨てた時間で表す', () => {
    expect(formatElapsed(before(HOUR_MS), NOW)).toBe('1時間前');
    expect(formatElapsed(before(3 * HOUR_MS), NOW)).toBe('3時間前');
    expect(formatElapsed(before(DAY_MS - SECOND_MS), NOW)).toBe('23時間前');
  });

  test('30日未満は切り捨てた日数で表す', () => {
    expect(formatElapsed(before(DAY_MS), NOW)).toBe('1日前');
    expect(formatElapsed(before(30 * DAY_MS - SECOND_MS), NOW)).toBe('29日前');
  });

  test('30日以上前は相対表現にせずnullを返す', () => {
    expect(formatElapsed(before(30 * DAY_MS), NOW)).toBeNull();
    expect(formatElapsed(before(400 * DAY_MS), NOW)).toBeNull();
  });
});

describe('formatRemaining', () => {
  test('期限を過ぎていれば「期限切れ」にする', () => {
    expect(formatRemaining(NOW, NOW)).toBe('期限切れ');
    expect(formatRemaining(before(DAY_MS), NOW)).toBe('期限切れ');
  });

  test('1時間未満は切り捨てた分で表し、1分未満でも「あと1分」にする', () => {
    expect(formatRemaining(after(SECOND_MS), NOW)).toBe('あと1分');
    expect(formatRemaining(after(2 * MINUTE_MS + 30 * SECOND_MS), NOW)).toBe(
      'あと2分',
    );
    expect(formatRemaining(after(HOUR_MS - SECOND_MS), NOW)).toBe('あと59分');
  });

  test('1日未満は切り捨てた時間で表す', () => {
    expect(formatRemaining(after(HOUR_MS), NOW)).toBe('あと1時間');
    expect(formatRemaining(after(2 * HOUR_MS + 59 * MINUTE_MS), NOW)).toBe(
      'あと2時間',
    );
    expect(formatRemaining(after(DAY_MS - SECOND_MS), NOW)).toBe('あと23時間');
  });

  test('60日未満は切り捨てた日数で表す', () => {
    expect(formatRemaining(after(DAY_MS), NOW)).toBe('あと1日');
    expect(formatRemaining(after(3 * DAY_MS), NOW)).toBe('あと3日');
    expect(formatRemaining(after(60 * DAY_MS - SECOND_MS), NOW)).toBe(
      'あと59日',
    );
  });

  test('60日以上は平均の月の日数で丸めた「あと約nか月」で表す', () => {
    expect(formatRemaining(after(60 * DAY_MS), NOW)).toBe('あと約2か月');
    expect(formatRemaining(after(243 * DAY_MS), NOW)).toBe('あと約8か月');
    expect(formatRemaining(after(441 * DAY_MS), NOW)).toBe('あと約14か月');
  });
});
