import { describe, expect, test } from 'bun:test';

import { pickFinalDateChoice } from './year-final-date-choice.ts';

const CHOICES = [
  '2027-05-09',
  '2027-05-16',
  '2027-05-23',
  '2027-05-30',
  '2027-06-06',
  '2027-06-13',
] as const;

describe('pickFinalDateChoice', () => {
  test('現在の決勝実施日が既定の日なら、既定の日に最も近い別の候補を選ぶ', () => {
    expect(
      pickFinalDateChoice({
        choices: CHOICES,
        current: '2027-05-30',
        preferred: '2027-05-30',
      }),
    ).toBe('2027-05-23');
  });

  test('現在の決勝実施日が既定の日でなければ、既定の日へ戻す', () => {
    expect(
      pickFinalDateChoice({
        choices: CHOICES,
        current: '2027-05-23',
        preferred: '2027-05-30',
      }),
    ).toBe('2027-05-30');
  });

  test('既定の日から前後に同じだけ離れた候補は、早い方を選ぶ', () => {
    expect(
      pickFinalDateChoice({
        choices: ['2027-06-06', '2027-05-23'],
        current: '2027-05-30',
        preferred: '2027-05-30',
      }),
    ).toBe('2027-05-23');
  });

  test('既定の日が候補に無ければ、現在と違う候補のうち既定の日に最も近い日を選ぶ', () => {
    expect(
      pickFinalDateChoice({
        choices: ['2027-01-03', '2027-03-07', '2027-04-04'],
        current: '2027-04-04',
        preferred: '2027-05-30',
      }),
    ).toBe('2027-03-07');
  });

  test('現在と違う候補が無ければ、例外を投げる', () => {
    expect(() =>
      pickFinalDateChoice({
        choices: ['2027-05-30'],
        current: '2027-05-30',
        preferred: '2027-05-30',
      }),
    ).toThrow(RangeError);
  });

  test('業務日付の形でない候補があれば、例外を投げる', () => {
    expect(() =>
      pickFinalDateChoice({
        choices: ['2027/05/23'],
        current: '2027-05-30',
        preferred: '2027-05-30',
      }),
    ).toThrow(RangeError);
  });
});
