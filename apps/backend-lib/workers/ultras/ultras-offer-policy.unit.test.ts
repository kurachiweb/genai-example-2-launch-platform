import { describe, expect, test } from 'bun:test';

import { PAYMENTS_UNAVAILABLE_MESSAGE } from '../../../common-lib/payments/payments-unavailable-texts.ts';
import { ultrasCheckoutNotesOf } from '../../../common-lib/ultras/checkout-notes.ts';
import type { UltrasPlanStatus } from '../../../common-lib/ultras/plan-status.ts';
import { AppError } from '../../core/errors/app-error.ts';
import type {
  PriceCatalog,
  PriceCatalogResult,
  StripePrice,
} from '../../core/payments/ports.ts';
import type { PurchaseOfferRequest } from '../../core/payments/purchase-kind-contract.ts';
import type {
  UltrasEntitlements,
  UltrasPlanView,
  UltrasPromotionFlagReader,
} from '../../core/ultras/ports.ts';
import { ensureLoggingConfigured } from '../logging/configure-logging.ts';
import {
  ULTRAS_OFFER_REJECTION_MESSAGES,
  UltrasOfferPolicy,
} from './ultras-offer-policy.ts';

const USER_ID = '01JC0USER00000000000000001';
const NOW = new Date('2026-11-06T04:21:00.000Z');
const REQUEST: PurchaseOfferRequest = Object.freeze({
  userId: USER_ID,
  targetId: null,
  now: NOW,
});

const MONTHLY_PRICE: StripePrice = Object.freeze({
  lookupKey: 'ultras_monthly',
  priceId: 'price_ultras_monthly',
  unitAmount: 999,
  currency: 'usd',
  recurringInterval: 'month',
});

const OTHER_PRICE: StripePrice = Object.freeze({
  lookupKey: 'payments_smoke',
  priceId: 'price_payments_smoke',
  unitAmount: 100,
  currency: 'usd',
  recurringInterval: null,
});

interface LoggedObject {
  readonly level: string;
  readonly category: string;
  readonly message: string;
  readonly [attribute: string]: unknown;
}

interface PlanLookup {
  readonly userId: string;
  readonly now: Date;
}

interface RecordingEntitlements {
  readonly entitlements: UltrasEntitlements;
  readonly lookups: PlanLookup[];
}

interface RecordingPriceCatalog {
  readonly prices: PriceCatalog;
  readonly requested: (readonly string[])[];
}

function unused(): never {
  throw new Error('このテストでは使わない操作です');
}

function flagReaderOf(enabled: boolean): UltrasPromotionFlagReader {
  return { isEnabled: () => Promise.resolve(enabled) };
}

function planOf(status: UltrasPlanStatus): UltrasPlanView {
  return {
    status,
    startedAt: new Date('2026-10-01T00:00:00.000Z'),
    currentPeriodEndsAt: new Date('2026-12-01T00:00:00.000Z'),
    benefitEndsAt: status === 'active' || status === 'past_due' ? null : NOW,
    canceledAt: status === 'canceled' ? NOW : null,
  };
}

function createRecordingEntitlements(
  plan: UltrasPlanView | null,
): RecordingEntitlements {
  const lookups: PlanLookup[] = [];
  const entitlements: UltrasEntitlements = {
    isEntitledAt: unused,
    wasEntitledDuring: unused,
    entitledUsersAt: unused,
    entitledUsersDuring: unused,
    currentPlan: (userId, now) => {
      lookups.push({ userId, now });
      return Promise.resolve(plan);
    },
  };
  return { entitlements, lookups };
}

function createRecordingPriceCatalog(
  result: PriceCatalogResult,
): RecordingPriceCatalog {
  const requested: (readonly string[])[] = [];
  const prices: PriceCatalog = {
    getPrices: (lookupKeys) => {
      requested.push(lookupKeys);
      return Promise.resolve(result);
    },
  };
  return { prices, requested };
}

function recordLogs(appName: 'api' | 'event' = 'api'): LoggedObject[] {
  const logs: LoggedObject[] = [];
  const record = (logged: unknown) => {
    logs.push(logged as LoggedObject);
  };
  ensureLoggingConfigured({
    appName,
    level: 'debug',
    console: {
      debug: record,
      info: record,
      warn: record,
      error: record,
    } as unknown as Console,
  });
  return logs;
}

function policyWith(parts: {
  readonly appName?: 'api' | 'event';
  readonly enabled?: boolean;
  readonly plan?: UltrasPlanView | null;
  readonly catalog?: PriceCatalogResult;
}): {
  readonly policy: UltrasOfferPolicy;
  readonly lookups: PlanLookup[];
  readonly requested: (readonly string[])[];
} {
  const { entitlements, lookups } = createRecordingEntitlements(
    parts.plan ?? null,
  );
  const { prices, requested } = createRecordingPriceCatalog(
    parts.catalog ?? { prices: [MONTHLY_PRICE], stale: false },
  );
  const policy = new UltrasOfferPolicy({
    appName: parts.appName ?? 'api',
    flags: flagReaderOf(parts.enabled ?? true),
    entitlements,
    prices,
  });
  return { policy, lookups, requested };
}

describe('ULTRAS_OFFER_REJECTION_MESSAGES', () => {
  test('拒否のコードごとの文言は文言規則の「Ultrasの加入の開始」の3行と一致する', () => {
    expect(ULTRAS_OFFER_REJECTION_MESSAGES).toEqual({
      ultras_unavailable: '現在、Ultrasの新規の加入を受け付けていません。',
      ultras_already_subscribed: '既にUltrasに加入しています。',
      ultras_resume_in_portal:
        '解約済みのUltrasは課金期間の末日まで有効です。継続するには「解約・支払い方法の管理」から解約を取り消してください。',
    });
  });

  test('文言の対応は変更できない', () => {
    expect(Object.isFrozen(ULTRAS_OFFER_REJECTION_MESSAGES)).toBe(true);
  });
});

describe('UltrasOfferPolicy', () => {
  describe('拒否の順序', () => {
    test('機能フラグがオフなら、加入中でも加入状態と価格を照会せずにultras_unavailableで拒否する', async () => {
      const { policy, lookups, requested } = policyWith({
        enabled: false,
        plan: planOf('active'),
      });

      const decision = await policy.describe(REQUEST);

      expect(decision).toEqual({
        kind: 'unavailable',
        code: 'ultras_unavailable',
        message: '現在、Ultrasの新規の加入を受け付けていません。',
      });
      expect(lookups).toEqual([]);
      expect(requested).toEqual([]);
    });

    test('機能フラグがオンで解約済みの加入が継続期間内なら、価格を照会せずにultras_resume_in_portalで拒否する', async () => {
      const { policy, lookups, requested } = policyWith({
        plan: planOf('canceled'),
      });

      const decision = await policy.describe(REQUEST);

      expect(decision).toEqual({
        kind: 'unavailable',
        code: 'ultras_resume_in_portal',
        message:
          '解約済みのUltrasは課金期間の末日まで有効です。継続するには「解約・支払い方法の管理」から解約を取り消してください。',
      });
      expect(lookups).toEqual([{ userId: USER_ID, now: NOW }]);
      expect(requested).toEqual([]);
    });

    test.each<UltrasPlanStatus>(['active', 'past_due'])(
      '機能フラグがオンで加入状態が%sなら、価格を照会せずにultras_already_subscribedで拒否する',
      async (status) => {
        const { policy, requested } = policyWith({ plan: planOf(status) });

        const decision = await policy.describe(REQUEST);

        expect(decision).toEqual({
          kind: 'unavailable',
          code: 'ultras_already_subscribed',
          message: '既にUltrasに加入しています。',
        });
        expect(requested).toEqual([]);
      },
    );

    test('加入状態が終了なら加入できる', async () => {
      const { policy } = policyWith({ plan: planOf('ended') });

      const decision = await policy.describe(REQUEST);

      expect(decision.kind).toBe('available');
    });

    test('加入したことが無ければ加入できる', async () => {
      const { policy } = policyWith({ plan: null });

      const decision = await policy.describe(REQUEST);

      expect(decision.kind).toBe('available');
    });
  });

  describe('購入の内容', () => {
    test('月額の価格のlookup_keyだけを照会する', async () => {
      const { policy, requested } = policyWith({});

      await policy.describe(REQUEST);

      expect(requested).toEqual([['ultras_monthly']]);
    });

    test('lookup_keyがultras_monthly・数量1・関連のIDなし・二重決済の鍵なし・期限なし・bot判定なしの購入にする', async () => {
      const { policy } = policyWith({});

      const decision = await policy.describe(REQUEST);

      expect(decision).toEqual({
        kind: 'available',
        offer: {
          priceLookupKey: 'ultras_monthly',
          quantity: 1,
          relatedId: null,
          exclusivityKey: null,
          deadlineAt: null,
          acceptUntil: null,
          fulfillableUntil: null,
          summary: {
            itemName: 'Ultrasプラン',
            quantityLabel: '1か月(毎月自動更新)',
            serviceTiming: '決済完了後ただちに',
            additionalNotes: ultrasCheckoutNotesOf(999),
          },
          requiresBotVerification: false,
        },
      });
    });

    test('追加事項は価格から作った毎月の請求額を含む、互いに異なる4つの文になる', async () => {
      const { policy } = policyWith({});

      const decision = await policy.describe(REQUEST);

      if (decision.kind !== 'available') {
        throw new Error('加入できる判定を期待しました');
      }
      const notes = decision.offer.summary.additionalNotes;
      expect(notes).toHaveLength(4);
      expect(new Set(notes).size).toBe(4);
      expect(notes[0]).toContain('$9.99(税込)');
    });

    test('照会の結果に他の価格が混ざっていても、lookup_keyが一致する価格の金額を使う', async () => {
      const { policy } = policyWith({
        catalog: {
          prices: [OTHER_PRICE, { ...MONTHLY_PRICE, unitAmount: 123_450 }],
          stale: true,
        },
      });

      const decision = await policy.describe(REQUEST);

      if (decision.kind !== 'available') {
        throw new Error('加入できる判定を期待しました');
      }
      expect(decision.offer.summary.additionalNotes[0]).toContain(
        '$1,234.50(税込)',
      );
    });

    test('返す購入の内容は変更できない', async () => {
      const { policy } = policyWith({});

      const decision = await policy.describe(REQUEST);

      if (decision.kind !== 'available') {
        throw new Error('加入できる判定を期待しました');
      }
      expect(Object.isFrozen(decision.offer)).toBe(true);
      expect(Object.isFrozen(decision.offer.summary)).toBe(true);
    });
  });

  describe('価格を取得できない時', () => {
    test('照会の結果に月額の価格が無ければ、lookup_keyを添えたwarnのログを出してpayments_unavailableを投げる', async () => {
      const logs = recordLogs('event');
      const { policy } = policyWith({
        appName: 'event',
        catalog: { prices: [OTHER_PRICE], stale: false },
      });

      const failure = await policy
        .describe(REQUEST)
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(AppError);
      expect(failure).toMatchObject({
        kind: 'unavailable',
        code: 'payments_unavailable',
        message: PAYMENTS_UNAVAILABLE_MESSAGE,
      });
      expect(logs).toMatchObject([
        {
          level: 'warning',
          category: 'event.application.ultras',
          priceLookup: 'ultras_monthly',
          stale: false,
        },
      ]);
    });

    test('照会の結果が空でも同じく投げる', async () => {
      recordLogs();
      const { policy } = policyWith({
        catalog: { prices: [], stale: false },
      });

      const failure = await policy
        .describe(REQUEST)
        .catch((error: unknown) => error);

      expect(failure).toMatchObject({ code: 'payments_unavailable' });
    });

    test('加入できる判定ではログを出さない', async () => {
      const logs = recordLogs();
      const { policy } = policyWith({});

      await policy.describe(REQUEST);

      expect(logs).toEqual([]);
    });
  });
});
