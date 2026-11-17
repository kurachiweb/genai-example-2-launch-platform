import { describe, expect, test } from 'bun:test';

import {
  ALIVE_ENTRY,
  CHAMPION_ENTRY,
  CLOSED_AWAITING_ENTRY,
  drawnEntryOf,
  ELIMINATED_ENTRY,
  ENTRY_ACCEPT_UNTIL,
  ENTRY_BRACKET_PATH,
  ENTRY_DRAW_AT,
  entryInputOf,
  excludedEntryOf,
  EXEMPT_AWAITING_ENTRY,
  expiredEntryOf,
  forfeitedEntryOf,
  PAID_ENTITLED_ENTRY,
  PRODUCT_UNAVAILABLE_ENTRY,
  PRODUCT_UNAVAILABLE_MESSAGE,
  SERVER_TIME_48_HOURS_BEFORE,
  serverTimeBeforeAcceptUntil,
  ULTRAS_ENTITLED_ENTRY,
} from './tournament-entry-fixtures.ts';
import {
  entryCountdownReadingOf,
  hasEntryCountdown,
  isEntryDeadlineUrgent,
  tournamentEntryBoundariesOf,
  tournamentEntryDisplayOf,
} from './tournament-entry-model.ts';

describe('tournamentEntryDisplayOf', () => {
  test('受付期限より前の支払い待ちは、参加費とUltrasの案内の要否を持つ決済の導線にする', () => {
    expect(tournamentEntryDisplayOf(entryInputOf())).toStrictEqual({
      kind: 'payable',
      feeAmount: 500,
      ultrasGuide: true,
      blockedReason: null,
    });
  });

  test('参加費を照会できない支払い待ちは、参加費を空にした決済の導線にする', () => {
    expect(
      tournamentEntryDisplayOf(
        entryInputOf({ feeAmount: null, ultrasGuide: false }),
      ),
    ).toStrictEqual({
      kind: 'payable',
      feeAmount: null,
      ultrasGuide: false,
      blockedReason: null,
    });
  });

  test('プロダクトを表示できない間の支払い待ちは、参加費を持ったまま決済を始められない理由を持つ決済の導線にする', () => {
    expect(tournamentEntryDisplayOf(PRODUCT_UNAVAILABLE_ENTRY)).toStrictEqual({
      kind: 'payable',
      feeAmount: 500,
      ultrasGuide: true,
      blockedReason: PRODUCT_UNAVAILABLE_MESSAGE,
    });
  });

  test('Ultrasの特典で免除される支払い待ちは、受付期限の後も免除にする', () => {
    expect(tournamentEntryDisplayOf(EXEMPT_AWAITING_ENTRY)).toStrictEqual({
      kind: 'exempt',
    });
    expect(
      tournamentEntryDisplayOf({
        ...EXEMPT_AWAITING_ENTRY,
        serverTime: serverTimeBeforeAcceptUntil(-1),
      }),
    ).toStrictEqual({ kind: 'exempt' });
  });

  test('受付期限ちょうど以降の支払い待ちは、受付の終了にする', () => {
    expect(
      tournamentEntryDisplayOf(
        entryInputOf({ serverTime: serverTimeBeforeAcceptUntil(0) }),
      ),
    ).toStrictEqual({ kind: 'closed' });
    expect(tournamentEntryDisplayOf(CLOSED_AWAITING_ENTRY)).toStrictEqual({
      kind: 'closed',
    });
    expect(
      tournamentEntryDisplayOf(
        entryInputOf({ serverTime: serverTimeBeforeAcceptUntil(1) }),
      ).kind,
    ).toBe('payable');
  });

  test('決済で参加資格を得た枠は、照会の組み合わせ決定の日時をそのまま持つ', () => {
    expect(tournamentEntryDisplayOf(PAID_ENTITLED_ENTRY)).toStrictEqual({
      kind: 'entitled',
      drawAt: ENTRY_DRAW_AT,
    });
    const delayed = '2026-11-24T08:00:00.000Z';
    expect(
      tournamentEntryDisplayOf({ ...PAID_ENTITLED_ENTRY, drawAt: delayed }),
    ).toStrictEqual({ kind: 'entitled', drawAt: delayed });
  });

  test('Ultrasで参加資格を得た枠は、免除にする', () => {
    expect(tournamentEntryDisplayOf(ULTRAS_ENTITLED_ENTRY)).toStrictEqual({
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
      expect(tournamentEntryDisplayOf(entry)).toStrictEqual({
        kind: 'drawn',
        outcome,
        bracketPath: ENTRY_BRACKET_PATH,
      });
    },
  );

  test('組み合わせに入っても進行が無ければ、勝ち残りにする', () => {
    expect(
      tournamentEntryDisplayOf({
        ...ALIVE_ENTRY,
        progress: null,
        bracketPath: null,
      }),
    ).toStrictEqual({
      kind: 'drawn',
      outcome: { type: 'alive' },
      bracketPath: null,
    });
  });

  test('期限切れは、組み合わせ決定の後の確定かを区別する', () => {
    expect(tournamentEntryDisplayOf(expiredEntryOf(false))).toStrictEqual({
      kind: 'expired',
      late: false,
    });
    expect(tournamentEntryDisplayOf(expiredEntryOf(true))).toStrictEqual({
      kind: 'expired',
      late: true,
    });
  });

  test('資格の喪失は、返金の対象のときだけ返金の文を添える', () => {
    expect(tournamentEntryDisplayOf(forfeitedEntryOf(true))).toStrictEqual({
      kind: 'forfeited',
      refund: true,
    });
    expect(tournamentEntryDisplayOf(forfeitedEntryOf(false))).toStrictEqual({
      kind: 'forfeited',
      refund: false,
    });
  });

  test('除外は、除外の理由を持ち、返金の対象のときだけ返金の文を添える', () => {
    expect(tournamentEntryDisplayOf(excludedEntryOf(true))).toStrictEqual({
      kind: 'excluded',
      reason: 'hidden_or_suspended',
      refund: true,
    });
    expect(tournamentEntryDisplayOf(excludedEntryOf(false))).toStrictEqual({
      kind: 'excluded',
      reason: 'hidden_or_suspended',
      refund: false,
    });
  });

  test('返金の対象は免除かどうかでなく入力の値に従う', () => {
    expect(
      tournamentEntryDisplayOf({ ...forfeitedEntryOf(true), exempt: true }),
    ).toStrictEqual({ kind: 'forfeited', refund: true });
    expect(
      tournamentEntryDisplayOf({ ...excludedEntryOf(false), exempt: false }),
    ).toStrictEqual({
      kind: 'excluded',
      reason: 'hidden_or_suspended',
      refund: false,
    });
  });

  test('理由の無い除外は、プロダクトが公開されていないことによる除外にする', () => {
    expect(tournamentEntryDisplayOf(excludedEntryOf(true, null))).toStrictEqual(
      {
        kind: 'excluded',
        reason: 'hidden_or_suspended',
        refund: true,
      },
    );
  });
});

describe('isEntryDeadlineUrgent', () => {
  test('受付期限まで48時間ちょうどは強調せず、48時間未満から強調する', () => {
    expect(
      isEntryDeadlineUrgent(ENTRY_ACCEPT_UNTIL, SERVER_TIME_48_HOURS_BEFORE),
    ).toBe(false);
    expect(
      isEntryDeadlineUrgent(
        ENTRY_ACCEPT_UNTIL,
        serverTimeBeforeAcceptUntil(48 * 3_600_000 - 1),
      ),
    ).toBe(true);
  });

  test('受付期限ちょうど以降は強調しない', () => {
    expect(
      isEntryDeadlineUrgent(ENTRY_ACCEPT_UNTIL, serverTimeBeforeAcceptUntil(0)),
    ).toBe(false);
  });
});

describe('hasEntryCountdown', () => {
  test('受付期限まで48時間未満の決済の導線だけが秒読みを持つ', () => {
    expect(
      hasEntryCountdown(
        entryInputOf({ serverTime: serverTimeBeforeAcceptUntil(3_600_000) }),
      ),
    ).toBe(true);
    expect(
      hasEntryCountdown(
        entryInputOf({ serverTime: SERVER_TIME_48_HOURS_BEFORE }),
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

describe('tournamentEntryBoundariesOf', () => {
  test('秒読みを添える決済の導線は、受付期限の48時間前と受付期限を境界にする', () => {
    expect(tournamentEntryBoundariesOf(entryInputOf(), true)).toStrictEqual([
      '2026-11-22T07:00:00.000Z',
      ENTRY_ACCEPT_UNTIL,
    ]);
  });

  test('秒読みを添えない決済の導線は、受付期限だけを境界にする', () => {
    expect(tournamentEntryBoundariesOf(entryInputOf(), false)).toStrictEqual([
      ENTRY_ACCEPT_UNTIL,
    ]);
  });

  test('決済の導線でない枠は、境界を持たない', () => {
    expect(
      tournamentEntryBoundariesOf(EXEMPT_AWAITING_ENTRY, true),
    ).toStrictEqual([]);
    expect(
      tournamentEntryBoundariesOf(PAID_ENTITLED_ENTRY, true),
    ).toStrictEqual([]);
    expect(
      tournamentEntryBoundariesOf(CLOSED_AWAITING_ENTRY, false),
    ).toStrictEqual([]);
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
