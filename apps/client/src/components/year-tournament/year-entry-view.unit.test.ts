import { describe, expect, test } from 'bun:test';

import {
  ALIVE_ENTRY,
  CHAMPION_ENTRY,
  closedEntryOf,
  ELIMINATED_ENTRY,
  EXEMPT_AWAITING_ENTRY,
  PAID_ENTITLED_ENTRY,
  SERVER_TIME_THREE_DAYS_BEFORE,
  ULTRAS_ENTITLED_ENTRY,
  YEAR_ENTRY_ACCEPT_UNTIL,
  YEAR_ENTRY_BRACKET_PATH,
  YEAR_ENTRY_DRAW_AT,
  YEAR_ENTRY_LAUNCH_ID,
  yearEntryOf,
} from './year-entry-fixtures.ts';
import { yearEntryInputOf } from './year-entry-view.ts';

describe('yearEntryInputOf', () => {
  test('受付中の枠は、照会の時刻と参加費を写し、Ultrasの案内と決済を始められない理由を持たない', () => {
    expect(yearEntryInputOf(yearEntryOf())).toStrictEqual({
      launchId: YEAR_ENTRY_LAUNCH_ID,
      status: 'AWAITING_PAYMENT',
      late: false,
      excludedReason: null,
      exempt: false,
      refundable: false,
      acceptUntil: YEAR_ENTRY_ACCEPT_UNTIL,
      drawAt: YEAR_ENTRY_DRAW_AT,
      serverTime: SERVER_TIME_THREE_DAYS_BEFORE,
      feeAmount: 2000,
      ultrasGuide: false,
      blockedReason: null,
      progress: null,
      bracketPath: null,
    });
  });

  test('参加費を照会できない枠は、参加費を空にする', () => {
    expect(yearEntryInputOf(yearEntryOf({ fee: null })).feeAmount).toBeNull();
  });

  test.each([
    ['受付中の免除', EXEMPT_AWAITING_ENTRY, 'AWAITING_PAYMENT', true],
    ['決済の参加資格', PAID_ENTITLED_ENTRY, 'ENTITLED', false],
    ['Ultrasの参加資格', ULTRAS_ENTITLED_ENTRY, 'ENTITLED', true],
  ] as const)('%sの枠は、状態と免除を写す', (_name, entry, status, exempt) => {
    const input = yearEntryInputOf(entry);
    expect(input.status).toBe(status);
    expect(input.exempt).toBe(exempt);
    expect(input.ultrasGuide).toBe(false);
  });

  test.each([
    [
      '勝ち残り',
      ALIVE_ENTRY,
      { alive: true, champion: false, eliminatedRoundName: null },
    ],
    [
      '敗退',
      ELIMINATED_ENTRY,
      { alive: false, champion: false, eliminatedRoundName: '準決勝' },
    ],
    [
      '優勝',
      CHAMPION_ENTRY,
      { alive: false, champion: true, eliminatedRoundName: null },
    ],
  ] as const)(
    '組み合わせに入った枠(%s)は、進行とブラケットの経路を写す',
    (_name, entry, progress) => {
      const input = yearEntryInputOf(entry);
      expect(input.status).toBe('DRAWN');
      expect(input.progress).toStrictEqual(progress);
      expect(input.bracketPath).toBe(YEAR_ENTRY_BRACKET_PATH);
    },
  );

  test.each([
    ['DEADLINE', false],
    ['LATE_ENTRY', true],
  ] as const)(
    '期限切れの理由%sは、組み合わせ決定の後の確定かを%sにする',
    (closeReason, late) => {
      expect(yearEntryInputOf(closedEntryOf('EXPIRED', closeReason)).late).toBe(
        late,
      );
    },
  );

  test.each([
    ['HIDDEN_OR_SUSPENDED', 'hidden_or_suspended'],
    ['OVER_CAPACITY', 'over_capacity'],
  ] as const)(
    '除外の理由%sは、閉じた理由%sに写す',
    (closeReason, excludedReason) => {
      expect(
        yearEntryInputOf(closedEntryOf('EXCLUDED', closeReason)).excludedReason,
      ).toBe(excludedReason);
    },
  );

  test.each([
    ['FORFEITED', 'DELETED'],
    ['FORFEITED', 'WITHDRAWN'],
    ['EXPIRED', 'DEADLINE'],
    ['EXPIRED', 'LATE_ENTRY'],
  ] as const)('%sの理由%sは、除外の理由を持たない', (status, closeReason) => {
    expect(
      yearEntryInputOf(closedEntryOf(status, closeReason)).excludedReason,
    ).toBeNull();
  });

  test.each([
    ['FORFEITED', 'DELETED'],
    ['FORFEITED', 'WITHDRAWN'],
    ['EXCLUDED', 'HIDDEN_OR_SUSPENDED'],
    ['EXCLUDED', 'OVER_CAPACITY'],
  ] as const)(
    '%s(%s)の枠の返金の対象は、免除かどうかでなくサーバーの値に従う',
    (status, closeReason) => {
      expect(
        yearEntryInputOf(closedEntryOf(status, closeReason, true)).refundable,
      ).toBe(true);
      expect(
        yearEntryInputOf(closedEntryOf(status, closeReason, false)).refundable,
      ).toBe(false);
      expect(
        yearEntryInputOf({
          ...closedEntryOf(status, closeReason, false),
          exempt: false,
        }).refundable,
      ).toBe(false);
      expect(
        yearEntryInputOf({
          ...closedEntryOf(status, closeReason, true),
          exempt: true,
        }).refundable,
      ).toBe(true);
    },
  );
});
