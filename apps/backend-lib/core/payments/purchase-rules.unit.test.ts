import { describe, expect, test } from 'bun:test';

import {
  PURCHASE_STATUSES,
  type PurchaseStatus,
} from '../../../common-lib/payments/purchase-states.ts';
import { AppError } from '../errors/app-error.ts';
import type { PurchaseOffer } from './purchase-kind-contract.ts';
import {
  ADVANCEABLE_FROM,
  assertAcceptable,
  computeSessionExpiry,
  decideCompletion,
  SESSION_DEFAULT_LIFETIME_MS,
  SESSION_MIN_LIFETIME_MS,
  SESSION_UNBOUNDED_LIFETIME_MS,
} from './purchase-rules.ts';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

const NOW = new Date('2026-11-05T12:00:00.000Z');

const after = (base: Date, ms: number): Date => new Date(base.getTime() + ms);

// トーナメント参加費の受付期限(UTC-08:00の23:00)
const ACCEPT_UNTIL = new Date('2026-11-06T07:00:00.000Z');

const offerWith = (acceptUntil: Date | null): PurchaseOffer => ({
  priceLookupKey: 'tournament_week_entry',
  quantity: 1,
  relatedId: null,
  exclusivityKey: null,
  deadlineAt: acceptUntil === null ? null : after(acceptUntil, 35 * MINUTE_MS),
  acceptUntil,
  fulfillableUntil:
    acceptUntil === null ? null : after(acceptUntil, 45 * MINUTE_MS),
  summary: {
    itemName: 'Weekトーナメント参加費',
    quantityLabel: '1件',
    serviceTiming: '組み合わせ決定の後',
    additionalNotes: [],
  },
  requiresBotVerification: false,
});

describe('有効期限の定数', () => {
  test('既定は24時間、決済期限の無い購入は1時間、下限は30分である', () => {
    expect(SESSION_DEFAULT_LIFETIME_MS).toBe(24 * HOUR_MS);
    expect(SESSION_UNBOUNDED_LIFETIME_MS).toBe(HOUR_MS);
    expect(SESSION_MIN_LIFETIME_MS).toBe(30 * MINUTE_MS);
  });
});

describe('computeSessionExpiry', () => {
  test('決済期限の無い購入は作成から1時間後にする', () => {
    expect(computeSessionExpiry(NOW, null)).toEqual(after(NOW, HOUR_MS));
  });

  test('決済期限が24時間より後なら作成から24時間後にする', () => {
    const deadlineAt = after(NOW, 30 * HOUR_MS);

    expect(computeSessionExpiry(NOW, deadlineAt)).toEqual(
      after(NOW, 24 * HOUR_MS),
    );
  });

  test('決済期限が24時間より前なら決済期限にする', () => {
    const deadlineAt = after(NOW, 5 * HOUR_MS);

    expect(computeSessionExpiry(NOW, deadlineAt)).toEqual(deadlineAt);
  });

  test('決済期限がちょうど24時間後ならその時刻にする', () => {
    const deadlineAt = after(NOW, 24 * HOUR_MS);

    expect(computeSessionExpiry(NOW, deadlineAt)).toEqual(deadlineAt);
  });

  test('決済期限が30分より前なら作成から30分後に引き上げる', () => {
    const deadlineAt = after(NOW, 10 * MINUTE_MS);

    expect(computeSessionExpiry(NOW, deadlineAt)).toEqual(
      after(NOW, 30 * MINUTE_MS),
    );
  });

  test('決済期限がちょうど30分後ならその時刻にする', () => {
    const deadlineAt = after(NOW, 30 * MINUTE_MS);

    expect(computeSessionExpiry(NOW, deadlineAt)).toEqual(deadlineAt);
  });

  test('決済期限が過ぎていても作成から30分後にする', () => {
    const deadlineAt = after(NOW, -HOUR_MS);

    expect(computeSessionExpiry(NOW, deadlineAt)).toEqual(
      after(NOW, 30 * MINUTE_MS),
    );
  });

  test('引数の日時を変えない', () => {
    const now = new Date(NOW);
    const deadlineAt = after(NOW, 5 * HOUR_MS);

    computeSessionExpiry(now, deadlineAt);

    expect(now).toEqual(NOW);
    expect(deadlineAt).toEqual(after(NOW, 5 * HOUR_MS));
  });
});

describe('assertAcceptable', () => {
  test('受付期限の1ミリ秒前は受け付ける', () => {
    expect(() => {
      assertAcceptable(after(ACCEPT_UNTIL, -1), offerWith(ACCEPT_UNTIL));
    }).not.toThrow();
  });

  test('受付期限ちょうどは422のcheckout_closedで拒否する', () => {
    const act = (): void => {
      assertAcceptable(ACCEPT_UNTIL, offerWith(ACCEPT_UNTIL));
    };

    expect(act).toThrow(AppError);
    expect(act).toThrow(
      expect.objectContaining({
        kind: 'unprocessable',
        code: 'checkout_closed',
        message: '決済の受付は終了しました。',
      }),
    );
  });

  test('受付期限の後は拒否する', () => {
    expect(() => {
      assertAcceptable(after(ACCEPT_UNTIL, HOUR_MS), offerWith(ACCEPT_UNTIL));
    }).toThrow(expect.objectContaining({ code: 'checkout_closed' }));
  });

  test('受付期限の無い購入は常に受け付ける', () => {
    expect(() => {
      assertAcceptable(after(NOW, 365 * 24 * HOUR_MS), offerWith(null));
    }).not.toThrow();
  });
});

describe('decideCompletion', () => {
  const fulfillableUntil = new Date('2026-11-06T07:45:00.000Z');

  test('反映の期限の前の支払いは権利の付与を試みる', () => {
    expect(
      decideCompletion({
        paidAt: after(fulfillableUntil, -1),
        fulfillableUntil,
      }),
    ).toEqual({ kind: 'try_fulfill' });
  });

  test('反映の期限ちょうどの支払いは権利の付与を試みる', () => {
    expect(
      decideCompletion({ paidAt: fulfillableUntil, fulfillableUntil }),
    ).toEqual({ kind: 'try_fulfill' });
  });

  test('反映の期限を過ぎた支払いはlateで拒否する', () => {
    expect(
      decideCompletion({
        paidAt: after(fulfillableUntil, 1),
        fulfillableUntil,
      }),
    ).toEqual({ kind: 'reject', reason: 'late' });
  });

  test('反映の期限の無い購入は常に権利の付与を試みる', () => {
    expect(
      decideCompletion({
        paidAt: after(NOW, 365 * 24 * HOUR_MS),
        fulfillableUntil: null,
      }),
    ).toEqual({ kind: 'try_fulfill' });
  });
});

describe('ADVANCEABLE_FROM', () => {
  const FINAL_STATUSES: readonly PurchaseStatus[] = [
    'fulfilled',
    'rejected',
    'expired',
  ];

  test('processingへはopenとsupersededから進める', () => {
    expect([...ADVANCEABLE_FROM.processing].sort()).toEqual([
      'open',
      'superseded',
    ]);
  });

  test.each(['fulfilled', 'rejected', 'expired'] as const)(
    '%sへはopen・processing・supersededから進める',
    (target) => {
      expect([...ADVANCEABLE_FROM[target]].sort()).toEqual([
        'open',
        'processing',
        'superseded',
      ]);
    },
  );

  test('完了した購入はどの状態へも戻らない', () => {
    const sources = Object.values(ADVANCEABLE_FROM).flat();

    for (const status of FINAL_STATUSES) {
      expect(sources).not.toContain(status);
    }
  });

  test('openとsupersededへ進める前進は無い', () => {
    expect(Object.keys(ADVANCEABLE_FROM).sort()).toEqual([
      'expired',
      'fulfilled',
      'processing',
      'rejected',
    ]);
  });

  test('元の状態はすべて購入の状態の値である', () => {
    for (const status of Object.values(ADVANCEABLE_FROM).flat()) {
      expect(PURCHASE_STATUSES).toContain(status);
    }
  });

  test('オブジェクトと各配列が凍結されている', () => {
    expect(Object.isFrozen(ADVANCEABLE_FROM)).toBe(true);
    for (const sources of Object.values(ADVANCEABLE_FROM)) {
      expect(Object.isFrozen(sources)).toBe(true);
    }
  });
});
