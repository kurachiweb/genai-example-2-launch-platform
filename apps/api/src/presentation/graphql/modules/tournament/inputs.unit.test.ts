import { describe, expect, test } from 'bun:test';

import { parseBusinessDate } from '../../../../../lib/core/time/business-time.ts';
import {
  businessDateArg,
  startTournamentCheckoutArgsOf,
  TOURNAMENT_BOARD_ARGS,
} from './inputs.ts';

const LAUNCH_ID = '01J0000000000000000000000A';

const LAUNCH_ID_INVALID_MESSAGE = '参加の枠が見つかりません。';

const CHECKOUT_ARGS = startTournamentCheckoutArgsOf(LAUNCH_ID_INVALID_MESSAGE);

function issueMessagesOf(result: {
  readonly success: boolean;
  readonly error?: { readonly issues: readonly { message: string }[] };
}): readonly string[] {
  return result.error?.issues.map(({ message }) => message) ?? [];
}

describe('businessDateArg', () => {
  test('業務日付の形の値をそのまま受け付ける', () => {
    expect(businessDateArg.parse('2027-05-30')).toBe(
      parseBusinessDate('2027-05-30'),
    );
  });

  test.each(['2027-5-30', '2027-02-30', '2027-05-30T00:00:00Z', ''])(
    '形式の違反と存在しない日付(%s)は同じ文言で拒否する',
    (value) => {
      expect(issueMessagesOf(businessDateArg.safeParse(value))).toEqual([
        '日付の指定が正しくありません。',
      ]);
    },
  );
});

describe('TOURNAMENT_BOARD_ARGS', () => {
  test('区画の照会の日付を業務日付として検証する', () => {
    expect(TOURNAMENT_BOARD_ARGS.parse({ date: '2027-05-30' })).toEqual({
      date: parseBusinessDate('2027-05-30'),
    });
    expect(
      issueMessagesOf(TOURNAMENT_BOARD_ARGS.safeParse({ date: '2027-13-01' })),
    ).toEqual(['日付の指定が正しくありません。']);
  });
});

describe('startTournamentCheckoutArgsOf', () => {
  test('大文字のULIDのローンチのIDを受け付ける', () => {
    expect(CHECKOUT_ARGS.parse({ launchId: LAUNCH_ID })).toEqual({
      launchId: LAUNCH_ID,
    });
  });

  test.each([LAUNCH_ID.toLowerCase(), 'not-a-ulid', ''])(
    'ULIDでないか小文字のID(%s)は渡した文言の1件で拒否する',
    (launchId) => {
      expect(issueMessagesOf(CHECKOUT_ARGS.safeParse({ launchId }))).toEqual([
        LAUNCH_ID_INVALID_MESSAGE,
      ]);
    },
  );
});
