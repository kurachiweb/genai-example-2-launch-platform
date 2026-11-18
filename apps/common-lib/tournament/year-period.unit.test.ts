import { describe, expect, test } from 'bun:test';

import { parseTournamentYear } from './year-period.ts';

describe('parseTournamentYear', () => {
  test.each([
    ['2027', 2027],
    ['2028', 2028],
    ['0001', 1],
    ['9999', 9999],
  ])('4桁の数字の%pは年の%dにする', (value, expected) => {
    expect(parseTournamentYear(value)).toBe(expected);
  });

  test.each([
    '27',
    '20270',
    'year',
    '2027a',
    '0000',
    ' 2027',
    '2027\n',
    '２０２７',
    '-202',
    '',
  ])('4桁の数字でないか1年より前の%pはundefinedにする', (value) => {
    expect(parseTournamentYear(value)).toBeUndefined();
  });
});
