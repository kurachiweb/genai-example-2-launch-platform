import { describe, expect, test } from 'bun:test';

import {
  ALIVE_ENTRY,
  CHAMPION_ENTRY,
  CLOSED_AWAITING_ENTRY,
  closedEntryOf,
  drawnEntryOf,
  ELIMINATED_ENTRY,
  EXEMPT_AWAITING_ENTRY,
  PAID_ENTITLED_ENTRY,
  SERVER_TIME_48_HOURS_BEFORE,
  serverTimeBeforeAcceptUntil,
  ULTRAS_ENTITLED_ENTRY,
  WEEK_ENTRY_ACCEPT_UNTIL,
  WEEK_ENTRY_BRACKET_PATH,
  WEEK_ENTRY_DRAW_AT,
  weekEntryOf,
} from './week-entry-fixtures.ts';
import {
  entryCountdownReadingOf,
  hasEntryCountdown,
  isEntryDeadlineUrgent,
  weekEntryBoundariesOf,
  weekEntryDisplayOf,
} from './week-entry-model.ts';

describe('weekEntryDisplayOf', () => {
  test('受付期限より前の支払い待ちは、参加費とUltrasの案内の要否を持つ決済の導線にする', () => {
    expect(weekEntryDisplayOf(weekEntryOf())).toStrictEqual({
      kind: 'payable',
      feeAmount: 500,
      ultrasGuide: true,
    });
  });

  test('参加費を照会できない支払い待ちは、参加費を空にした決済の導線にする', () => {
    expect(
      weekEntryDisplayOf(weekEntryOf({ fee: null, ultrasGuide: false })),
    ).toStrictEqual({ kind: 'payable', feeAmount: null, ultrasGuide: false });
  });

  test('Ultrasの特典で免除される支払い待ちは、受付期限の後も免除にする', () => {
    expect(weekEntryDisplayOf(EXEMPT_AWAITING_ENTRY)).toStrictEqual({
      kind: 'exempt',
    });
    expect(
      weekEntryDisplayOf({
        ...EXEMPT_AWAITING_ENTRY,
        serverTime: serverTimeBeforeAcceptUntil(-1),
      }),
    ).toStrictEqual({ kind: 'exempt' });
  });

  test('受付期限ちょうど以降の支払い待ちは、受付の終了にする', () => {
    expect(
      weekEntryDisplayOf(
        weekEntryOf({ serverTime: serverTimeBeforeAcceptUntil(0) }),
      ),
    ).toStrictEqual({ kind: 'closed' });
    expect(weekEntryDisplayOf(CLOSED_AWAITING_ENTRY)).toStrictEqual({
      kind: 'closed',
    });
    expect(
      weekEntryDisplayOf(
        weekEntryOf({ serverTime: serverTimeBeforeAcceptUntil(1) }),
      ).kind,
    ).toBe('payable');
  });

  test('決済で参加資格を得た枠は、照会の組み合わせ決定の日時をそのまま持つ', () => {
    expect(weekEntryDisplayOf(PAID_ENTITLED_ENTRY)).toStrictEqual({
      kind: 'entitled',
      drawAt: WEEK_ENTRY_DRAW_AT,
    });
    const delayed = '2026-11-24T08:00:00.000Z';
    expect(
      weekEntryDisplayOf({ ...PAID_ENTITLED_ENTRY, drawAt: delayed }),
    ).toStrictEqual({ kind: 'entitled', drawAt: delayed });
  });

  test('Ultrasで参加資格を得た枠は、免除にする', () => {
    expect(weekEntryDisplayOf(ULTRAS_ENTITLED_ENTRY)).toStrictEqual({
      kind: 'exempt',
    });
  });

  test.each([
    ['勝ち残り', ALIVE_ENTRY, { type: 'alive' }],
    ['優勝', CHAMPION_ENTRY, { type: 'champion' }],
    ['敗退', ELIMINATED_ENTRY, { type: 'eliminated', roundName: '準決勝' }],
    [
      '敗退したラウンド名の無い進行の終了',
      drawnEntryOf({
        alive: false,
        champion: false,
        eliminatedRoundName: null,
      }),
      { type: 'alive' },
    ],
  ] as const)(
    '組み合わせに入った枠(%s)は、進行とブラケットの経路を持つ',
    (_name, entry, outcome) => {
      expect(weekEntryDisplayOf(entry)).toStrictEqual({
        kind: 'drawn',
        outcome,
        bracketPath: WEEK_ENTRY_BRACKET_PATH,
      });
    },
  );

  test('組み合わせに入っても進行が無ければ、勝ち残りにする', () => {
    expect(
      weekEntryDisplayOf({ ...ALIVE_ENTRY, progress: null, bracketPath: null }),
    ).toStrictEqual({
      kind: 'drawn',
      outcome: { type: 'alive' },
      bracketPath: null,
    });
  });

  test('期限切れは、組み合わせ決定の後の予選の勝利かを区別する', () => {
    expect(
      weekEntryDisplayOf(closedEntryOf('EXPIRED', 'DEADLINE')),
    ).toStrictEqual({ kind: 'expired', late: false });
    expect(
      weekEntryDisplayOf(closedEntryOf('EXPIRED', 'LATE_ENTRY')),
    ).toStrictEqual({ kind: 'expired', late: true });
  });

  test.each([
    ['FORFEITED', 'DELETED', 'forfeited'],
    ['EXCLUDED', 'HIDDEN_OR_SUSPENDED', 'excluded'],
  ] as const)(
    '%sは、Ultrasの特典の枠でなければ返金の文を添える',
    (status, closeReason, kind) => {
      expect(
        weekEntryDisplayOf(closedEntryOf(status, closeReason)),
      ).toStrictEqual({ kind, refund: true });
      expect(
        weekEntryDisplayOf(closedEntryOf(status, closeReason, true)),
      ).toStrictEqual({ kind, refund: false });
    },
  );
});

describe('isEntryDeadlineUrgent', () => {
  test('受付期限まで48時間ちょうどは強調せず、48時間未満から強調する', () => {
    expect(
      isEntryDeadlineUrgent(
        WEEK_ENTRY_ACCEPT_UNTIL,
        SERVER_TIME_48_HOURS_BEFORE,
      ),
    ).toBe(false);
    expect(
      isEntryDeadlineUrgent(
        WEEK_ENTRY_ACCEPT_UNTIL,
        serverTimeBeforeAcceptUntil(48 * 3_600_000 - 1),
      ),
    ).toBe(true);
  });

  test('受付期限ちょうど以降は強調しない', () => {
    expect(
      isEntryDeadlineUrgent(
        WEEK_ENTRY_ACCEPT_UNTIL,
        serverTimeBeforeAcceptUntil(0),
      ),
    ).toBe(false);
  });
});

describe('hasEntryCountdown', () => {
  test('受付期限まで48時間未満の決済の導線だけが秒読みを持つ', () => {
    expect(
      hasEntryCountdown(
        weekEntryOf({ serverTime: serverTimeBeforeAcceptUntil(3_600_000) }),
      ),
    ).toBe(true);
    expect(
      hasEntryCountdown(
        weekEntryOf({ serverTime: SERVER_TIME_48_HOURS_BEFORE }),
      ),
    ).toBe(false);
    expect(
      hasEntryCountdown({
        ...EXEMPT_AWAITING_ENTRY,
        serverTime: serverTimeBeforeAcceptUntil(3_600_000),
      }),
    ).toBe(false);
    expect(hasEntryCountdown(CLOSED_AWAITING_ENTRY)).toBe(false);
    expect(hasEntryCountdown(null)).toBe(false);
  });
});

describe('weekEntryBoundariesOf', () => {
  test('決済の導線は、受付期限の48時間前と受付期限を境界にする', () => {
    expect(weekEntryBoundariesOf(weekEntryOf())).toStrictEqual([
      '2026-11-22T07:00:00.000Z',
      WEEK_ENTRY_ACCEPT_UNTIL,
    ]);
  });

  test('決済の導線でない枠は、境界を持たない', () => {
    expect(weekEntryBoundariesOf(EXEMPT_AWAITING_ENTRY)).toStrictEqual([]);
    expect(weekEntryBoundariesOf(PAID_ENTITLED_ENTRY)).toStrictEqual([]);
    expect(weekEntryBoundariesOf(CLOSED_AWAITING_ENTRY)).toStrictEqual([]);
  });
});

describe('entryCountdownReadingOf', () => {
  test('時間と分、1時間未満は分、1分未満はその旨で読み上げる', () => {
    expect(entryCountdownReadingOf(47 * 3600 + 59 * 60 + 59)).toBe(
      '締め切りまであと47時間59分',
    );
    expect(entryCountdownReadingOf(12 * 60 + 5)).toBe('締め切りまであと12分');
    expect(entryCountdownReadingOf(59)).toBe('締め切りまであと1分未満');
  });
});
