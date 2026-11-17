import { describe, expect, test } from 'bun:test';

import {
  ALIVE_ENTRY,
  closedEntryOf,
  EXEMPT_AWAITING_ENTRY,
  PRODUCT_UNAVAILABLE_ENTRY,
  PRODUCT_UNAVAILABLE_MESSAGE,
  SERVER_TIME_THREE_DAYS_BEFORE,
  WEEK_ENTRY_ACCEPT_UNTIL,
  WEEK_ENTRY_BRACKET_PATH,
  WEEK_ENTRY_DRAW_AT,
  WEEK_ENTRY_LAUNCH_ID,
  weekEntryOf,
} from './week-entry-fixtures.ts';
import { weekEntryInputOf } from './week-entry-view.ts';

describe('weekEntryInputOf', () => {
  test('受付中の枠は、照会の時刻・参加費・Ultrasの案内をそのまま写す', () => {
    expect(weekEntryInputOf(weekEntryOf())).toStrictEqual({
      launchId: WEEK_ENTRY_LAUNCH_ID,
      status: 'AWAITING_PAYMENT',
      late: false,
      excludedReason: null,
      exempt: false,
      refundable: true,
      acceptUntil: WEEK_ENTRY_ACCEPT_UNTIL,
      drawAt: WEEK_ENTRY_DRAW_AT,
      serverTime: SERVER_TIME_THREE_DAYS_BEFORE,
      feeAmount: 500,
      ultrasGuide: true,
      blockedReason: null,
      progress: null,
      bracketPath: null,
    });
  });

  test('参加費を照会できない枠は、参加費を空にする', () => {
    expect(weekEntryInputOf(weekEntryOf({ fee: null })).feeAmount).toBeNull();
  });

  test('決済を始められない理由は、その文言を写す', () => {
    expect(weekEntryInputOf(PRODUCT_UNAVAILABLE_ENTRY).blockedReason).toBe(
      PRODUCT_UNAVAILABLE_MESSAGE,
    );
  });

  test('組み合わせに入った枠は、進行とブラケットの経路を写す', () => {
    const input = weekEntryInputOf(ALIVE_ENTRY);
    expect(input.status).toBe('DRAWN');
    expect(input.progress).toStrictEqual({
      alive: true,
      champion: false,
      eliminatedRoundName: null,
    });
    expect(input.bracketPath).toBe(WEEK_ENTRY_BRACKET_PATH);
  });

  test.each([
    ['DEADLINE', false],
    ['LATE_ENTRY', true],
  ] as const)(
    '期限切れの理由%sは、組み合わせ決定の後の確定かを%sにする',
    (closeReason, late) => {
      expect(weekEntryInputOf(closedEntryOf('EXPIRED', closeReason)).late).toBe(
        late,
      );
    },
  );

  test('除外の理由は、プロダクトが公開されていないことだけにする', () => {
    expect(
      weekEntryInputOf(closedEntryOf('EXCLUDED', 'HIDDEN_OR_SUSPENDED'))
        .excludedReason,
    ).toBe('hidden_or_suspended');
    expect(
      weekEntryInputOf(closedEntryOf('FORFEITED', 'DELETED')).excludedReason,
    ).toBeNull();
  });

  test.each([
    ['FORFEITED', 'DELETED'],
    ['EXCLUDED', 'HIDDEN_OR_SUSPENDED'],
  ] as const)(
    '%sの枠は、Ultrasの特典の枠でなければ返金の対象にする',
    (status, closeReason) => {
      expect(
        weekEntryInputOf(closedEntryOf(status, closeReason)).refundable,
      ).toBe(true);
      expect(
        weekEntryInputOf(closedEntryOf(status, closeReason, true)).refundable,
      ).toBe(false);
    },
  );

  test('免除の枠は、免除を写し返金の対象にしない', () => {
    const input = weekEntryInputOf(EXEMPT_AWAITING_ENTRY);
    expect(input.exempt).toBe(true);
    expect(input.refundable).toBe(false);
  });
});
