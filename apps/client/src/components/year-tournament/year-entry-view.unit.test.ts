import { describe, expect, test } from 'bun:test';

import {
  ALIVE_ENTRY,
  CHAMPION_ENTRY,
  CLOSED_AWAITING_ENTRY,
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
import {
  hasYearEntryDeleteNotice,
  yearEntryInputOf,
} from './year-entry-view.ts';

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

describe('hasYearEntryDeleteNotice', () => {
  test.each([
    ['受付期限より前の支払い待ち', yearEntryOf()],
    ['受付期限の後で組み合わせ決定の前の支払い待ち', CLOSED_AWAITING_ENTRY],
    ['Ultrasの特典で免除される支払い待ち', EXEMPT_AWAITING_ENTRY],
    ['決済で参加資格を得た枠', PAID_ENTITLED_ENTRY],
    ['Ultrasの特典で参加資格を得た枠', ULTRAS_ENTITLED_ENTRY],
  ])('%sは削除の注意書きを出す', (_name, entry) => {
    expect(hasYearEntryDeleteNotice(entry)).toBe(true);
  });

  test.each([
    ['枠が無い', null],
    ['組み合わせに入った枠', ALIVE_ENTRY],
    ['敗退した枠', ELIMINATED_ENTRY],
    ['優勝した枠', CHAMPION_ENTRY],
    ['期限切れの枠', closedEntryOf('EXPIRED', 'DEADLINE')],
    ['遅れて作られた期限切れの枠', closedEntryOf('EXPIRED', 'LATE_ENTRY')],
    ['喪失した枠', closedEntryOf('FORFEITED', 'DELETED', true)],
    ['除外された枠', closedEntryOf('EXCLUDED', 'HIDDEN_OR_SUSPENDED', true)],
    ['上限で除外された枠', closedEntryOf('EXCLUDED', 'OVER_CAPACITY', true)],
  ])('%sは削除の注意書きを出さない', (_name, entry) => {
    expect(hasYearEntryDeleteNotice(entry)).toBe(false);
  });
});
