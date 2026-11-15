import { describe, expect, test } from 'bun:test';

import { LifecycleRegistrationError } from '../identity/user-lifecycle.ts';
import { type BusinessDate, parseBusinessDate } from '../time/business-time.ts';
import {
  assertEveningDispatchParticipants,
  EVENING_DISPATCH_PARTICIPANTS_LABEL,
  EveningDispatchError,
  type EveningDispatchReadyInput,
  parseEveningDispatchReadyInput,
} from './evening-dispatch.ts';

const WEEK_PARTICIPANT = 'tournament-week.pairing';
const PARTICIPANTS = [WEEK_PARTICIPANT, 'tournament-year.pairing'];
const AT = new Date('2026-10-25T07:45:03.000Z');

const input = (
  overrides: Partial<EveningDispatchReadyInput> = {},
): EveningDispatchReadyInput => ({
  participant: WEEK_PARTICIPANT,
  date: parseBusinessDate('2026-10-24'),
  at: AT,
  ...overrides,
});

const captureError = (run: () => unknown): EveningDispatchError => {
  try {
    run();
  } catch (error) {
    if (error instanceof EveningDispatchError) {
      return error;
    }
    throw error;
  }
  throw new Error('EveningDispatchErrorが投げられませんでした');
};

describe('assertEveningDispatchParticipants', () => {
  test('前提が無い初版の登録口と、<spec名>.<名詞句>の名前の一覧を受け付ける', () => {
    expect(() => {
      assertEveningDispatchParticipants([]);
    }).not.toThrow();
    expect(() => {
      assertEveningDispatchParticipants(PARTICIPANTS);
    }).not.toThrow();
  });

  test.each([
    ['ピリオドの無い名前', 'tournament-week'],
    ['大文字を含む名前', 'Tournament-week.pairing'],
    ['下線を含む名前', 'tournament_week.pairing'],
    ['3つに区切った名前', 'tournament-week.pairing.final'],
    ['名詞句が空の名前', 'tournament-week.'],
    ['先頭がハイフンの名前', '-tournament.pairing'],
  ])('%sを登録口の呼び名とともに拒否する', (_label, name) => {
    expect(() => {
      assertEveningDispatchParticipants([name]);
    }).toThrow(LifecycleRegistrationError);
    expect(() => {
      assertEveningDispatchParticipants([name]);
    }).toThrow(EVENING_DISPATCH_PARTICIPANTS_LABEL);
  });

  test('同じ名前の重複を拒否する', () => {
    expect(() => {
      assertEveningDispatchParticipants([...PARTICIPANTS, WEEK_PARTICIPANT]);
    }).toThrow(LifecycleRegistrationError);
    expect(() => {
      assertEveningDispatchParticipants([...PARTICIPANTS, WEEK_PARTICIPANT]);
    }).toThrow('重複');
  });
});

describe('parseEveningDispatchReadyInput', () => {
  test('登録された前提の名前と業務日付の入力をそのまま返す', () => {
    expect(parseEveningDispatchReadyInput(input(), PARTICIPANTS)).toEqual(
      input(),
    );
  });

  test('登録されていない前提の名前を拒否する', () => {
    const error = captureError(() =>
      parseEveningDispatchReadyInput(
        input({ participant: 'tournament-month.pairing' }),
        PARTICIPANTS,
      ),
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('EveningDispatchError');
    expect(error.reason).toBe('unknown-participant');
  });

  test('前提が無い登録口ではどの名前も登録されていない', () => {
    expect(
      captureError(() => parseEveningDispatchReadyInput(input(), [])).reason,
    ).toBe('unknown-participant');
  });

  test.each([
    ['存在しない日付', '2026-02-30'],
    ['形式の違う日付', '2026/10/24'],
  ])('%sの業務日付を拒否する', (_label, date) => {
    expect(
      captureError(() =>
        parseEveningDispatchReadyInput(
          input({ date: date as BusinessDate }),
          PARTICIPANTS,
        ),
      ).reason,
    ).toBe('invalid-date');
  });

  test('不正な日時の呼び出しの時点を拒否する', () => {
    expect(
      captureError(() =>
        parseEveningDispatchReadyInput(
          input({ at: new Date(Number.NaN) }),
          PARTICIPANTS,
        ),
      ).reason,
    ).toBe('invalid-date');
  });
});
