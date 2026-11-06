import { describe, expect, test } from 'bun:test';

import {
  benefitEndForScheduledEnd,
  type StripeSubscriptionStatus,
  type SubscriptionSnapshot,
} from './entitlement-rules.ts';
import {
  applySubscriptionChange,
  EMPTY_SUBSCRIPTION_SNAPSHOT,
  ENDED_STRIPE_STATUSES,
  isEndedStripeStatus,
  type SubscriptionChangeInput,
} from './subscription-transition.ts';

const SUBSCRIPTION_ID = 'sub_ultras_0001';
const STARTED_AT = new Date('2026-10-01T15:00:00.000Z');
const SCHEDULED_AT = new Date('2026-10-15T09:00:00.000Z');
const OCCURRED_AT = new Date('2026-10-20T12:34:56.789Z');
const LATER_AT = new Date('2026-10-22T01:02:03.004Z');
// 業務日付2026-11-01の7:00。末日の終わりは2026-11-02T08:00:00.000Z
const PERIOD_END = new Date('2026-11-01T15:00:00.000Z');
const PERIOD_END_BENEFIT_END = new Date('2026-11-02T08:00:00.000Z');
const NEXT_PERIOD_END = new Date('2026-12-01T15:00:00.000Z');
// 業務日付2026-11-14の19:00。末日の終わりは2026-11-15T08:00:00.000Z
const CANCEL_AT = new Date('2026-11-15T03:00:00.000Z');
const CANCEL_AT_BENEFIT_END = new Date('2026-11-15T08:00:00.000Z');
const PAST_DUE_AT = new Date('2026-10-18T06:00:00.000Z');
const RETRY_ENDED_AT = new Date('2026-10-25T03:07:11.000Z');
const IMMEDIATE_ENDED_AT = new Date('2026-10-20T12:34:50.000Z');

const millisecondsAfter = (instant: Date, milliseconds: number): Date =>
  new Date(instant.getTime() + milliseconds);

const activeSnapshot = (
  overrides: Partial<SubscriptionSnapshot> = {},
): SubscriptionSnapshot => ({
  stripeStatus: 'active',
  cancelScheduled: false,
  cancelAt: null,
  currentPeriodEnd: PERIOD_END,
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

const scheduledSnapshot = (
  overrides: Partial<SubscriptionSnapshot> = {},
): SubscriptionSnapshot =>
  activeSnapshot({
    cancelScheduled: true,
    benefitEndsAt: PERIOD_END_BENEFIT_END,
    canceledAt: SCHEDULED_AT,
    cancellationSource: 'user',
    ...overrides,
  });

const changeOf = (
  overrides: Partial<SubscriptionChangeInput> = {},
): SubscriptionChangeInput => ({
  status: 'active',
  cancelAtPeriodEnd: false,
  cancelAt: null,
  currentPeriodEnd: PERIOD_END,
  endedAt: null,
  occurredAt: OCCURRED_AT,
  ...overrides,
});

const apply = (
  previous: SubscriptionSnapshot,
  change: SubscriptionChangeInput,
) => applySubscriptionChange(previous, change, SUBSCRIPTION_ID);

const dedupeKeyOf = (kind: string, instant: Date): string =>
  `${kind}:${SUBSCRIPTION_ID}:${String(instant.getTime())}`;

describe('applySubscriptionChange', () => {
  describe('Stripe側の値', () => {
    test('状態・予約・予定時刻・課金期間の終了・終了の時刻を最新の値に置き換える', () => {
      const result = apply(
        activeSnapshot(),
        changeOf({
          status: 'trialing',
          cancelAtPeriodEnd: true,
          cancelAt: CANCEL_AT,
          currentPeriodEnd: NEXT_PERIOD_END,
          endedAt: null,
        }),
      );

      expect(result.next).toMatchObject({
        stripeStatus: 'trialing',
        cancelScheduled: true,
        cancelAt: CANCEL_AT,
        currentPeriodEnd: NEXT_PERIOD_END,
        endedAt: null,
      });
    });

    test('有効になった時刻と保留中の解約の出どころは変化によって変わらない', () => {
      const result = apply(
        activeSnapshot({ pendingCancellationSource: 'suspension' }),
        changeOf({ currentPeriodEnd: NEXT_PERIOD_END }),
      );

      expect(result.next.startedAt).toEqual(STARTED_AT);
      expect(result.next.pendingCancellationSource).toBe('suspension');
    });

    test('入力の値を書き換えず、新しい値を返す', () => {
      const previous = Object.freeze(activeSnapshot());
      const change = Object.freeze(changeOf({ cancelAtPeriodEnd: true }));

      const result = apply(previous, change);

      expect(result.next).not.toBe(previous);
      expect(previous).toEqual(activeSnapshot());
      expect(change).toEqual(changeOf({ cancelAtPeriodEnd: true }));
    });
  });

  describe('解約の予約', () => {
    test('cancel_at_period_endだけの予約で、課金期間の末日の終わりを特典の終了時刻にする', () => {
      const result = apply(
        activeSnapshot(),
        changeOf({ cancelAtPeriodEnd: true }),
      );

      expect(result.next).toEqual(
        activeSnapshot({
          cancelScheduled: true,
          benefitEndsAt: PERIOD_END_BENEFIT_END,
          canceledAt: OCCURRED_AT,
          cancellationSource: 'user',
        }),
      );
      expect(result.next.benefitEndsAt).toEqual(
        benefitEndForScheduledEnd(PERIOD_END),
      );
      expect(result.anomalies).toEqual([]);
    });

    test('解約の予定時刻だけの予約(柔軟な請求モード)で、予定時刻の末日の終わりを特典の終了時刻にする', () => {
      const result = apply(activeSnapshot(), changeOf({ cancelAt: CANCEL_AT }));

      expect(result.next).toEqual(
        activeSnapshot({
          cancelScheduled: true,
          cancelAt: CANCEL_AT,
          benefitEndsAt: CANCEL_AT_BENEFIT_END,
          canceledAt: OCCURRED_AT,
          cancellationSource: 'user',
        }),
      );
      expect(result.anomalies).toEqual([]);
    });

    test('予定時刻と課金期間の終了の両方があれば予定時刻を優先する', () => {
      const result = apply(
        activeSnapshot(),
        changeOf({ cancelAtPeriodEnd: true, cancelAt: CANCEL_AT }),
      );

      expect(result.next.benefitEndsAt).toEqual(CANCEL_AT_BENEFIT_END);
    });

    test('予約が無ければ特典の終了時刻は空のままで、依頼も異常も無い', () => {
      const result = apply(activeSnapshot(), changeOf());

      expect(result).toEqual({
        next: activeSnapshot(),
        notices: [],
        anomalies: [],
      });
    });

    test('予約の取り消しで特典の終了時刻が空に戻り、解約の操作の時刻と出どころも空になる', () => {
      const result = apply(scheduledSnapshot(), changeOf());

      expect(result.next).toEqual(activeSnapshot());
      expect(result.notices).toEqual([]);
    });

    test('予約が続いている間は解約の操作の時刻を変えず、依頼を作り直さない', () => {
      const result = apply(
        scheduledSnapshot(),
        changeOf({ cancelAtPeriodEnd: true, occurredAt: LATER_AT }),
      );

      expect(result.next.canceledAt).toEqual(SCHEDULED_AT);
      expect(result.next.cancellationSource).toBe('user');
      expect(result.notices).toEqual([]);
    });

    test('予約があるのに予定時刻も課金期間の終了も無ければ、特典の終了時刻を空のままにし異常として返す', () => {
      const result = apply(
        activeSnapshot(),
        changeOf({ cancelAtPeriodEnd: true, currentPeriodEnd: null }),
      );

      expect(result.next.cancelScheduled).toBe(true);
      expect(result.next.benefitEndsAt).toBeNull();
      expect(result.anomalies).toEqual([{ kind: 'scheduled_end_missing' }]);
    });
  });

  describe('解約の操作の記録と解約の受付の依頼', () => {
    test('利用者の予約では出どころをuserとし、解約の受付の依頼を1件作る', () => {
      const result = apply(
        activeSnapshot(),
        changeOf({ cancelAtPeriodEnd: true }),
      );

      expect(result.notices).toEqual([
        {
          kind: 'cancellation_accepted',
          dedupeKey: dedupeKeyOf('cancellation_accepted', OCCURRED_AT),
          benefitEndsAt: PERIOD_END_BENEFIT_END,
          acceptedAt: OCCURRED_AT,
        },
      ]);
    });

    test.each(['suspension', 'withdrawal'] as const)(
      '出どころが%sなら、その出どころを記録して保留を残し、依頼を作らない',
      (source) => {
        const result = apply(
          activeSnapshot({ pendingCancellationSource: source }),
          changeOf({ cancelAtPeriodEnd: true }),
        );

        expect(result.next).toEqual(
          activeSnapshot({
            cancelScheduled: true,
            benefitEndsAt: PERIOD_END_BENEFIT_END,
            canceledAt: OCCURRED_AT,
            cancellationSource: source,
            pendingCancellationSource: source,
          }),
        );
        expect(result.notices).toEqual([]);
      },
    );

    test('予約の取り消しの後に再び予約されたら、新しい操作の時刻で依頼を作る', () => {
      const uncanceled = apply(scheduledSnapshot(), changeOf());

      const result = apply(
        uncanceled.next,
        changeOf({ cancelAtPeriodEnd: true, occurredAt: LATER_AT }),
      );

      expect(result.next.canceledAt).toEqual(LATER_AT);
      expect(result.notices.map((notice) => notice.dedupeKey)).toEqual([
        dedupeKeyOf('cancellation_accepted', LATER_AT),
      ]);
    });
  });

  describe('終了', () => {
    test('予約された定期課金が課金期間の末日に終了したら、特典の終了時刻を予約時の値のまま固定する', () => {
      const result = apply(
        scheduledSnapshot(),
        changeOf({
          status: 'canceled',
          cancelAtPeriodEnd: true,
          endedAt: PERIOD_END,
          occurredAt: millisecondsAfter(PERIOD_END, 1_500),
        }),
      );

      expect(result.next).toEqual(
        scheduledSnapshot({
          stripeStatus: 'canceled',
          endedAt: PERIOD_END,
          benefitEndsAt: PERIOD_END_BENEFIT_END,
          benefitEndFixed: true,
        }),
      );
      expect(result.notices).toEqual([]);
      expect(result.anomalies).toEqual([]);
    });

    test('終了の時刻が予定時刻より少し後でも、予定時刻の末日の終わりを特典の終了時刻にする', () => {
      const result = apply(
        scheduledSnapshot(),
        changeOf({
          status: 'canceled',
          cancelAtPeriodEnd: true,
          endedAt: millisecondsAfter(PERIOD_END, 5_000),
          occurredAt: millisecondsAfter(PERIOD_END, 6_000),
        }),
      );

      expect(result.next.benefitEndsAt).toEqual(PERIOD_END_BENEFIT_END);
      expect(result.next.benefitEndFixed).toBe(true);
    });

    test('解約の予定時刻だけの予約が予定時刻に終了しても、予定時刻の末日の終わりのまま固定する', () => {
      const result = apply(
        scheduledSnapshot({
          cancelAt: CANCEL_AT,
          benefitEndsAt: CANCEL_AT_BENEFIT_END,
        }),
        changeOf({
          status: 'canceled',
          cancelAt: CANCEL_AT,
          endedAt: CANCEL_AT,
          occurredAt: millisecondsAfter(CANCEL_AT, 1_000),
        }),
      );

      expect(result.next.benefitEndsAt).toEqual(CANCEL_AT_BENEFIT_END);
      expect(result.next.benefitEndFixed).toBe(true);
    });

    test('支払いの再試行の後の終了は、日の終わりまで延ばさずその終了の時刻で特典を終える', () => {
      const result = apply(
        activeSnapshot({ stripeStatus: 'past_due', pastDueSince: PAST_DUE_AT }),
        changeOf({
          status: 'canceled',
          endedAt: RETRY_ENDED_AT,
          occurredAt: millisecondsAfter(RETRY_ENDED_AT, 1_000),
        }),
      );

      expect(result.next).toEqual(
        activeSnapshot({
          stripeStatus: 'canceled',
          endedAt: RETRY_ENDED_AT,
          benefitEndsAt: RETRY_ENDED_AT,
          benefitEndFixed: true,
        }),
      );
      expect(result.notices).toEqual([]);
      expect(result.anomalies).toEqual([]);
    });

    test('未払いの状態は終了として扱い、終了の時刻が無ければ変化の時刻で特典を終えて異常として返す', () => {
      const result = apply(
        activeSnapshot({ stripeStatus: 'past_due', pastDueSince: PAST_DUE_AT }),
        changeOf({ status: 'unpaid', occurredAt: RETRY_ENDED_AT }),
      );

      expect(result.next).toEqual(
        activeSnapshot({
          stripeStatus: 'unpaid',
          benefitEndsAt: RETRY_ENDED_AT,
          benefitEndFixed: true,
        }),
      );
      expect(result.notices).toEqual([]);
      expect(result.anomalies).toEqual([
        { kind: 'unexpected_status', status: 'unpaid' },
      ]);
    });

    test('一時停止の状態も終了として扱い、異常として返す', () => {
      const result = apply(
        activeSnapshot(),
        changeOf({ status: 'paused', occurredAt: LATER_AT }),
      );

      expect(result.next.benefitEndsAt).toEqual(LATER_AT);
      expect(result.next.benefitEndFixed).toBe(true);
      expect(result.anomalies).toEqual([
        { kind: 'unexpected_status', status: 'paused' },
      ]);
    });

    test('予約の無い即時の解約は、その終了の時刻で特典を終え、解約の操作の時刻は記録しない', () => {
      const result = apply(
        activeSnapshot({ pendingCancellationSource: 'withdrawal' }),
        changeOf({ status: 'canceled', endedAt: IMMEDIATE_ENDED_AT }),
      );

      expect(result.next).toEqual(
        activeSnapshot({
          stripeStatus: 'canceled',
          endedAt: IMMEDIATE_ENDED_AT,
          benefitEndsAt: IMMEDIATE_ENDED_AT,
          benefitEndFixed: true,
          pendingCancellationSource: 'withdrawal',
        }),
      );
      expect(result.notices).toEqual([]);
    });

    test('予約があっても予定時刻より前に終了したら、その終了の時刻で特典を終える', () => {
      const result = apply(
        scheduledSnapshot(),
        changeOf({
          status: 'canceled',
          cancelAtPeriodEnd: true,
          endedAt: RETRY_ENDED_AT,
          occurredAt: millisecondsAfter(RETRY_ENDED_AT, 1_000),
        }),
      );

      expect(result.next.benefitEndsAt).toEqual(RETRY_ENDED_AT);
      expect(result.next.benefitEndFixed).toBe(true);
    });

    test('終了の状態で決めた特典の終了時刻は、後から届いた変化で変わらない', () => {
      const ended = activeSnapshot({
        stripeStatus: 'canceled',
        endedAt: IMMEDIATE_ENDED_AT,
        benefitEndsAt: IMMEDIATE_ENDED_AT,
        benefitEndFixed: true,
      });

      const result = apply(
        ended,
        changeOf({
          status: 'canceled',
          currentPeriodEnd: NEXT_PERIOD_END,
          endedAt: RETRY_ENDED_AT,
          occurredAt: LATER_AT,
        }),
      );

      expect(result.next).toEqual({
        ...ended,
        currentPeriodEnd: NEXT_PERIOD_END,
        endedAt: RETRY_ENDED_AT,
      });
    });

    test('終了した加入に予約の無い形の変化が届いても、解約の操作の記録を消さない', () => {
      const result = apply(
        scheduledSnapshot({
          stripeStatus: 'canceled',
          endedAt: PERIOD_END,
          benefitEndFixed: true,
        }),
        changeOf({
          status: 'canceled',
          endedAt: PERIOD_END,
          occurredAt: millisecondsAfter(PERIOD_END, 60_000),
        }),
      );

      expect(result.next.cancelScheduled).toBe(false);
      expect(result.next.canceledAt).toEqual(SCHEDULED_AT);
      expect(result.next.cancellationSource).toBe('user');
    });

    test('終了の変化で予約のフラグが落ちていても、以前の予約だけで予定時刻の末日の終わりまで特典を続ける', () => {
      const result = apply(
        scheduledSnapshot(),
        changeOf({
          status: 'canceled',
          cancelAtPeriodEnd: false,
          cancelAt: null,
          currentPeriodEnd: PERIOD_END,
          endedAt: PERIOD_END,
          occurredAt: millisecondsAfter(PERIOD_END, 1_500),
        }),
      );

      expect(result.next).toEqual(
        scheduledSnapshot({
          stripeStatus: 'canceled',
          cancelScheduled: false,
          endedAt: PERIOD_END,
          benefitEndsAt: PERIOD_END_BENEFIT_END,
          benefitEndFixed: true,
        }),
      );
      expect(result.next.benefitEndsAt).toEqual(
        benefitEndForScheduledEnd(PERIOD_END),
      );
      expect(result.next.canceledAt).toEqual(SCHEDULED_AT);
      expect(result.next.cancellationSource).toBe('user');
      expect(result.notices).toEqual([]);
    });

    test('終了の変化で予約のフラグが落ちていて予定時刻より前に終了したら、その終了の時刻で特典を終え記録は保つ', () => {
      const result = apply(
        scheduledSnapshot(),
        changeOf({
          status: 'canceled',
          cancelAtPeriodEnd: false,
          cancelAt: null,
          endedAt: RETRY_ENDED_AT,
          occurredAt: millisecondsAfter(RETRY_ENDED_AT, 1_000),
        }),
      );

      expect(result.next.benefitEndsAt).toEqual(RETRY_ENDED_AT);
      expect(result.next.benefitEndFixed).toBe(true);
      expect(result.next.canceledAt).toEqual(SCHEDULED_AT);
      expect(result.next.cancellationSource).toBe('user');
      expect(result.notices).toEqual([]);
    });

    test('初めて予約を見たのが終了の変化なら、解約の操作は記録するが受付の依頼は作らない', () => {
      const occurredAt = millisecondsAfter(PERIOD_END, 1_500);

      const result = apply(
        activeSnapshot(),
        changeOf({
          status: 'canceled',
          cancelAtPeriodEnd: true,
          endedAt: PERIOD_END,
          occurredAt,
        }),
      );

      expect(result.next).toEqual(
        activeSnapshot({
          stripeStatus: 'canceled',
          cancelScheduled: true,
          endedAt: PERIOD_END,
          benefitEndsAt: PERIOD_END_BENEFIT_END,
          benefitEndFixed: true,
          canceledAt: occurredAt,
          cancellationSource: 'user',
        }),
      );
      expect(result.notices).toEqual([]);
    });

    test.each([
      {
        name: '予約された定期課金の末日の終了',
        previous: scheduledSnapshot(),
        change: changeOf({
          status: 'canceled',
          cancelAtPeriodEnd: true,
          endedAt: PERIOD_END,
        }),
      },
      {
        name: '支払いの再試行の後の終了',
        previous: activeSnapshot({
          stripeStatus: 'past_due',
          pastDueSince: PAST_DUE_AT,
        }),
        change: changeOf({ status: 'canceled', endedAt: RETRY_ENDED_AT }),
      },
      {
        name: '即時の解約',
        previous: activeSnapshot(),
        change: changeOf({ status: 'canceled', endedAt: IMMEDIATE_ENDED_AT }),
      },
      {
        name: '未払いへの変化',
        previous: activeSnapshot(),
        change: changeOf({ status: 'unpaid' }),
      },
    ])('$nameではメールの依頼を作らない', ({ previous, change }) => {
      expect(apply(previous, change).notices).toEqual([]);
    });
  });

  describe('支払いの失敗', () => {
    test('past_due以外からpast_dueへの変化で失敗の時刻を記録し、支払いの失敗の依頼を1件だけ作る', () => {
      const result = apply(activeSnapshot(), changeOf({ status: 'past_due' }));

      expect(result.next).toEqual(
        activeSnapshot({ stripeStatus: 'past_due', pastDueSince: OCCURRED_AT }),
      );
      expect(result.notices).toEqual([
        {
          kind: 'payment_failed',
          dedupeKey: dedupeKeyOf('payment_failed', OCCURRED_AT),
          benefitEndsAt: null,
          acceptedAt: OCCURRED_AT,
        },
      ]);
    });

    test('past_dueのままなら失敗の時刻を変えず、依頼を作らない', () => {
      const result = apply(
        activeSnapshot({ stripeStatus: 'past_due', pastDueSince: PAST_DUE_AT }),
        changeOf({ status: 'past_due', occurredAt: LATER_AT }),
      );

      expect(result.next.pastDueSince).toEqual(PAST_DUE_AT);
      expect(result.notices).toEqual([]);
    });

    test('回復で失敗の時刻を空にし、依頼を作らない', () => {
      const result = apply(
        activeSnapshot({ stripeStatus: 'past_due', pastDueSince: PAST_DUE_AT }),
        changeOf({ status: 'active', occurredAt: LATER_AT }),
      );

      expect(result.next).toEqual(activeSnapshot());
      expect(result.notices).toEqual([]);
    });

    test('回復の後に再び失敗したら、別の重複排除キーで新しい依頼を作る', () => {
      const secondFailureAt = new Date('2026-11-18T06:00:00.000Z');
      const first = apply(
        activeSnapshot(),
        changeOf({ status: 'past_due', occurredAt: PAST_DUE_AT }),
      );
      const recovered = apply(
        first.next,
        changeOf({ status: 'active', occurredAt: LATER_AT }),
      );

      const second = apply(
        recovered.next,
        changeOf({ status: 'past_due', occurredAt: secondFailureAt }),
      );

      expect(second.next.pastDueSince).toEqual(secondFailureAt);
      expect(second.notices.map((notice) => notice.dedupeKey)).toEqual([
        dedupeKeyOf('payment_failed', secondFailureAt),
      ]);
      expect(first.notices.map((notice) => notice.dedupeKey)).toEqual([
        dedupeKeyOf('payment_failed', PAST_DUE_AT),
      ]);
    });

    test('解約が予約された加入の支払いの失敗の依頼には、その特典の終了時刻を載せる', () => {
      const result = apply(
        scheduledSnapshot(),
        changeOf({ status: 'past_due', cancelAtPeriodEnd: true }),
      );

      expect(result.notices).toEqual([
        {
          kind: 'payment_failed',
          dedupeKey: dedupeKeyOf('payment_failed', OCCURRED_AT),
          benefitEndsAt: PERIOD_END_BENEFIT_END,
          acceptedAt: OCCURRED_AT,
        },
      ]);
    });

    test('支払いの失敗と利用者の予約が同じ変化で起きたら、両方の依頼を作る', () => {
      const result = apply(
        activeSnapshot(),
        changeOf({ status: 'past_due', cancelAtPeriodEnd: true }),
      );

      expect(result.notices.map((notice) => notice.kind)).toEqual([
        'payment_failed',
        'cancellation_accepted',
      ]);
    });
  });

  describe('有効化の前', () => {
    test('有効になる前の変化はStripe側の値と特典の終了時刻を保存し、解約の操作は記録せず依頼も作らない', () => {
      const result = apply(
        EMPTY_SUBSCRIPTION_SNAPSHOT,
        changeOf({ cancelAtPeriodEnd: true }),
      );

      expect(result.next).toEqual({
        ...EMPTY_SUBSCRIPTION_SNAPSHOT,
        stripeStatus: 'active',
        cancelScheduled: true,
        currentPeriodEnd: PERIOD_END,
        benefitEndsAt: PERIOD_END_BENEFIT_END,
      });
      expect(result.notices).toEqual([]);
    });

    test('有効になる前のpast_dueでは失敗の時刻を記録せず、依頼も作らない', () => {
      const result = apply(
        EMPTY_SUBSCRIPTION_SNAPSHOT,
        changeOf({ status: 'past_due' }),
      );

      expect(result.next.stripeStatus).toBe('past_due');
      expect(result.next.pastDueSince).toBeNull();
      expect(result.notices).toEqual([]);
    });

    test('有効になる前に期限切れで終了したら、その終了の時刻を固定する', () => {
      const result = apply(
        EMPTY_SUBSCRIPTION_SNAPSHOT,
        changeOf({
          status: 'incomplete_expired',
          currentPeriodEnd: null,
          endedAt: IMMEDIATE_ENDED_AT,
        }),
      );

      expect(result.next.benefitEndsAt).toEqual(IMMEDIATE_ENDED_AT);
      expect(result.next.benefitEndFixed).toBe(true);
      expect(result.next.startedAt).toBeNull();
    });
  });
});

describe('EMPTY_SUBSCRIPTION_SNAPSHOT', () => {
  test('未有効の空の値は初回の支払いの前の状態で、時刻と予約と記録を持たない', () => {
    expect(EMPTY_SUBSCRIPTION_SNAPSHOT).toEqual({
      stripeStatus: 'incomplete',
      cancelScheduled: false,
      cancelAt: null,
      currentPeriodEnd: null,
      endedAt: null,
      startedAt: null,
      benefitEndsAt: null,
      benefitEndFixed: false,
      canceledAt: null,
      cancellationSource: null,
      pendingCancellationSource: null,
      pastDueSince: null,
    });
  });

  test('凍結されていて書き換えられない', () => {
    expect(Object.isFrozen(EMPTY_SUBSCRIPTION_SNAPSHOT)).toBe(true);
  });
});

describe('isEndedStripeStatus', () => {
  test.each<[StripeSubscriptionStatus, boolean]>([
    ['incomplete', false],
    ['incomplete_expired', true],
    ['trialing', false],
    ['active', false],
    ['past_due', false],
    ['canceled', true],
    ['unpaid', true],
    ['paused', true],
  ])('%sの終了の判定は%pである', (status, expected) => {
    expect(isEndedStripeStatus(status)).toBe(expected);
  });
});

describe('ENDED_STRIPE_STATUSES', () => {
  test('終了の状態は解約・未払い・期限切れ・一時停止の4つで、凍結されている', () => {
    expect(ENDED_STRIPE_STATUSES).toEqual([
      'canceled',
      'unpaid',
      'incomplete_expired',
      'paused',
    ]);
    expect(Object.isFrozen(ENDED_STRIPE_STATUSES)).toBe(true);
  });

  test('isEndedStripeStatusと同じ集合である', () => {
    const ended = new Set<StripeSubscriptionStatus>(ENDED_STRIPE_STATUSES);
    const statuses: readonly StripeSubscriptionStatus[] = [
      'incomplete',
      'incomplete_expired',
      'trialing',
      'active',
      'past_due',
      'canceled',
      'unpaid',
      'paused',
    ];
    for (const status of statuses) {
      expect(isEndedStripeStatus(status)).toBe(ended.has(status));
    }
  });
});
