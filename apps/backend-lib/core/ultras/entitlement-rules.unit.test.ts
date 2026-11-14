import { describe, expect, test } from 'bun:test';

import {
  benefitEndForScheduledEnd,
  derivePlanStatus,
  endOfBusinessDayContaining,
  isEntitledAt,
  overlapsPeriod,
  type SubscriptionSnapshot,
} from './entitlement-rules.ts';

const STARTED_AT = new Date('2026-10-01T15:00:00.000Z');
const BENEFIT_ENDS_AT = new Date('2026-11-06T08:00:00.000Z');

const snapshotOf = (
  overrides: Partial<SubscriptionSnapshot> = {},
): SubscriptionSnapshot => ({
  stripeStatus: 'active',
  cancelScheduled: false,
  cancelAt: null,
  currentPeriodEnd: null,
  endedAt: null,
  startedAt: STARTED_AT,
  benefitEndsAt: null,
  benefitEndFixed: false,
  canceledAt: null,
  cancellationSource: null,
  pendingCancellationSource: null,
  pastDueSince: null,
  ...overrides,
});

const millisecondsBefore = (instant: Date, milliseconds: number): Date =>
  new Date(instant.getTime() - milliseconds);

const millisecondsAfter = (instant: Date, milliseconds: number): Date =>
  new Date(instant.getTime() + milliseconds);

describe('endOfBusinessDayContaining', () => {
  test('業務日付の0:00ちょうどはその日の終わり(翌日の0:00)になる', () => {
    const result = endOfBusinessDayContaining(
      new Date('2026-11-06T08:00:00.000Z'),
    );

    expect(result.toISOString()).toBe('2026-11-07T08:00:00.000Z');
  });

  test('業務日付の0:00の1ミリ秒後も同じ日の終わりになる', () => {
    const result = endOfBusinessDayContaining(
      new Date('2026-11-06T08:00:00.001Z'),
    );

    expect(result.toISOString()).toBe('2026-11-07T08:00:00.000Z');
  });

  test('業務日付の23:59:59.999はその日の終わりになり、次の日に繰り上がらない', () => {
    const result = endOfBusinessDayContaining(
      new Date('2026-11-07T07:59:59.999Z'),
    );

    expect(result.toISOString()).toBe('2026-11-07T08:00:00.000Z');
  });

  test('年をまたぐ業務日付の終わりも固定オフセットで求める', () => {
    const result = endOfBusinessDayContaining(
      new Date('2027-01-01T02:00:00.000Z'),
    );

    expect(result.toISOString()).toBe('2027-01-01T08:00:00.000Z');
  });

  test('入力の時点を書き換えない', () => {
    const instant = new Date('2026-11-06T08:00:00.000Z');

    endOfBusinessDayContaining(instant);

    expect(instant.toISOString()).toBe('2026-11-06T08:00:00.000Z');
  });

  test('不正な時点を例外にする', () => {
    expect(() => endOfBusinessDayContaining(new Date(Number.NaN))).toThrow(
      RangeError,
    );
  });
});

describe('benefitEndForScheduledEnd', () => {
  test('課金期間の終了が業務日付の日中なら、その日の終わりを特典の終了時刻にする', () => {
    const result = benefitEndForScheduledEnd(
      new Date('2026-11-05T18:00:00.000Z'),
    );

    expect(result.toISOString()).toBe('2026-11-06T08:00:00.000Z');
  });

  test('課金期間の終了が業務日付の0:00ちょうどなら、最後の瞬間が属する前日の終わりにする', () => {
    const result = benefitEndForScheduledEnd(
      new Date('2026-11-06T08:00:00.000Z'),
    );

    expect(result.toISOString()).toBe('2026-11-06T08:00:00.000Z');
  });

  test('課金期間の終了が業務日付の0:00の1ミリ秒後なら、その日の終わりにする', () => {
    const result = benefitEndForScheduledEnd(
      new Date('2026-11-06T08:00:00.001Z'),
    );

    expect(result.toISOString()).toBe('2026-11-07T08:00:00.000Z');
  });

  test('入力の時点を書き換えない', () => {
    const scheduledEnd = new Date('2026-11-06T08:00:00.000Z');

    benefitEndForScheduledEnd(scheduledEnd);

    expect(scheduledEnd.toISOString()).toBe('2026-11-06T08:00:00.000Z');
  });
});

describe('derivePlanStatus', () => {
  const now = new Date('2026-10-20T00:00:00.000Z');

  test('加入が有効になっていなければnullを返す', () => {
    expect(
      derivePlanStatus(
        snapshotOf({ startedAt: null, stripeStatus: 'incomplete' }),
        now,
      ),
    ).toBeNull();
  });

  test('有効で解約が予約されておらずStripe側が有効ならactiveになる', () => {
    expect(derivePlanStatus(snapshotOf(), now)).toBe('active');
  });

  test('Stripe側が支払いの失敗の再試行中ならpast_dueになる', () => {
    expect(
      derivePlanStatus(snapshotOf({ stripeStatus: 'past_due' }), now),
    ).toBe('past_due');
  });

  test('特典の終了時刻が決まっていて、まだ過ぎていなければcanceledになる', () => {
    expect(
      derivePlanStatus(snapshotOf({ benefitEndsAt: BENEFIT_ENDS_AT }), now),
    ).toBe('canceled');
  });

  test('解約が予約された定期課金が終了しても、特典の終了時刻までcanceledのままである', () => {
    const snapshot = snapshotOf({
      stripeStatus: 'canceled',
      cancelScheduled: true,
      endedAt: new Date('2026-11-05T18:00:00.000Z'),
      benefitEndsAt: BENEFIT_ENDS_AT,
      benefitEndFixed: true,
    });

    expect(
      derivePlanStatus(snapshot, millisecondsBefore(BENEFIT_ENDS_AT, 1)),
    ).toBe('canceled');
  });

  test('特典の終了時刻ちょうどでendedになる', () => {
    expect(
      derivePlanStatus(
        snapshotOf({ benefitEndsAt: BENEFIT_ENDS_AT }),
        BENEFIT_ENDS_AT,
      ),
    ).toBe('ended');
  });

  test('特典の終了時刻を過ぎていればendedになる', () => {
    expect(
      derivePlanStatus(
        snapshotOf({ stripeStatus: 'unpaid', benefitEndsAt: BENEFIT_ENDS_AT }),
        millisecondsAfter(BENEFIT_ENDS_AT, 1),
      ),
    ).toBe('ended');
  });

  test('支払いの再試行中に解約が予約されていてもpast_dueを優先する', () => {
    expect(
      derivePlanStatus(
        snapshotOf({
          stripeStatus: 'past_due',
          benefitEndsAt: BENEFIT_ENDS_AT,
        }),
        now,
      ),
    ).toBe('past_due');
  });

  test('特典の終了時刻を過ぎていれば支払いの再試行中でもendedを優先する', () => {
    expect(
      derivePlanStatus(
        snapshotOf({
          stripeStatus: 'past_due',
          benefitEndsAt: BENEFIT_ENDS_AT,
        }),
        millisecondsAfter(BENEFIT_ENDS_AT, 1),
      ),
    ).toBe('ended');
  });

  test('判定は渡された時点だけで決まり、時計を読まない', () => {
    const snapshot = snapshotOf({ benefitEndsAt: BENEFIT_ENDS_AT });

    expect(
      derivePlanStatus(snapshot, new Date('2000-01-01T00:00:00.000Z')),
    ).toBe('canceled');
    expect(
      derivePlanStatus(snapshot, new Date('2100-01-01T00:00:00.000Z')),
    ).toBe('ended');
  });
});

describe('isEntitledAt', () => {
  test('加入が有効になっていなければ特典を受けられない', () => {
    expect(
      isEntitledAt({ startedAt: null, benefitEndsAt: null }, STARTED_AT),
    ).toBe(false);
  });

  test('有効になった時刻ちょうどは特典を受けられる(左端を含む)', () => {
    expect(
      isEntitledAt({ startedAt: STARTED_AT, benefitEndsAt: null }, STARTED_AT),
    ).toBe(true);
  });

  test('有効になる1ミリ秒前は特典を受けられない', () => {
    expect(
      isEntitledAt(
        { startedAt: STARTED_AT, benefitEndsAt: null },
        millisecondsBefore(STARTED_AT, 1),
      ),
    ).toBe(false);
  });

  test('特典の終了時刻が無ければ、有効になった後はいつでも特典を受けられる', () => {
    expect(
      isEntitledAt(
        { startedAt: STARTED_AT, benefitEndsAt: null },
        new Date('2100-01-01T00:00:00.000Z'),
      ),
    ).toBe(true);
  });

  test('特典の終了時刻の1ミリ秒前は特典を受けられる', () => {
    expect(
      isEntitledAt(
        { startedAt: STARTED_AT, benefitEndsAt: BENEFIT_ENDS_AT },
        millisecondsBefore(BENEFIT_ENDS_AT, 1),
      ),
    ).toBe(true);
  });

  test('特典の終了時刻ちょうどは特典を受けられない(右端を含まない)', () => {
    expect(
      isEntitledAt(
        { startedAt: STARTED_AT, benefitEndsAt: BENEFIT_ENDS_AT },
        BENEFIT_ENDS_AT,
      ),
    ).toBe(false);
  });
});

describe('overlapsPeriod', () => {
  const benefit = { startedAt: STARTED_AT, benefitEndsAt: BENEFIT_ENDS_AT };

  test('加入が有効になっていなければ重ならない', () => {
    expect(
      overlapsPeriod(
        { startedAt: null, benefitEndsAt: null },
        new Date('2000-01-01T00:00:00.000Z'),
        new Date('2100-01-01T00:00:00.000Z'),
      ),
    ).toBe(false);
  });

  test('期間の終わりが有効になった時刻ちょうどなら重なる(期間の右端を含む)', () => {
    expect(
      overlapsPeriod(
        benefit,
        millisecondsBefore(STARTED_AT, 1_000),
        STARTED_AT,
      ),
    ).toBe(true);
  });

  test('期間の終わりが有効になる1ミリ秒前なら重ならない', () => {
    expect(
      overlapsPeriod(
        benefit,
        millisecondsBefore(STARTED_AT, 1_000),
        millisecondsBefore(STARTED_AT, 1),
      ),
    ).toBe(false);
  });

  test('期間の始まりが特典の終了時刻の1ミリ秒前なら重なる', () => {
    expect(
      overlapsPeriod(
        benefit,
        millisecondsBefore(BENEFIT_ENDS_AT, 1),
        millisecondsAfter(BENEFIT_ENDS_AT, 1_000),
      ),
    ).toBe(true);
  });

  test('期間の始まりが特典の終了時刻ちょうどなら重ならない(特典の右端を含まない)', () => {
    expect(
      overlapsPeriod(
        benefit,
        BENEFIT_ENDS_AT,
        millisecondsAfter(BENEFIT_ENDS_AT, 1_000),
      ),
    ).toBe(false);
  });

  test('特典の終了時刻が無ければ、有効になった後のどの期間とも重なる', () => {
    expect(
      overlapsPeriod(
        { startedAt: STARTED_AT, benefitEndsAt: null },
        new Date('2090-01-01T00:00:00.000Z'),
        new Date('2100-01-01T00:00:00.000Z'),
      ),
    ).toBe(true);
  });

  test('特典の継続期間に収まる期間は重なる', () => {
    expect(
      overlapsPeriod(
        benefit,
        new Date('2026-10-10T00:00:00.000Z'),
        new Date('2026-10-20T00:00:00.000Z'),
      ),
    ).toBe(true);
  });

  test('特典の継続期間を含む期間は重なる', () => {
    expect(
      overlapsPeriod(
        benefit,
        millisecondsBefore(STARTED_AT, 1_000),
        millisecondsAfter(BENEFIT_ENDS_AT, 1_000),
      ),
    ).toBe(true);
  });

  test('1つの時点だけの期間は、isEntitledAtの左端と同じく有効になった時刻で重なる', () => {
    expect(overlapsPeriod(benefit, STARTED_AT, STARTED_AT)).toBe(true);
  });
});
