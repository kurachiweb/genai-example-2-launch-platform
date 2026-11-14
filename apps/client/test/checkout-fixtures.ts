import type { ClientCheckoutQuery } from '../src/graphql/generated/graphql.ts';

export type CheckoutResult = ClientCheckoutQuery['checkout'];

export const CHECKOUT_PURCHASE_ID = '01JC0PURCHASE0000000000001';

export const CHECKOUT_CLIENT_SECRET = ['cs', 'test', 'checkout'].join('_');

const DAY_MS = 24 * 60 * 60 * 1000;

const HOUR_MS = 60 * 60 * 1000;

// 残り時間の相対表現が日単位の切り捨てで確定するよう、3日と1時間の後にする
export const acceptUntilInThreeDays = (): string =>
  new Date(Date.now() + 3 * DAY_MS + HOUR_MS).toISOString();

export const openCheckout = (
  overrides: Partial<CheckoutResult> = {},
): CheckoutResult => ({
  purchaseId: CHECKOUT_PURCHASE_ID,
  kind: 'WEEK_TOURNAMENT_ENTRY',
  status: 'OPEN',
  rejectionReason: null,
  clientSecret: CHECKOUT_CLIENT_SECRET,
  unitPrice: { amount: 1200, currency: 'usd' },
  quantity: 1,
  total: { amount: 1200, currency: 'usd' },
  summary: {
    itemName: 'Weekトーナメントの参加費',
    quantityLabel: '1件',
    serviceTiming: '購入の確定後すぐに参加資格を付与します。',
    additionalNotes: [],
    isSubscription: false,
  },
  acceptUntil: acceptUntilInThreeDays(),
  expiresAt: new Date(Date.now() + DAY_MS).toISOString(),
  consentVersion: '2026-10-23',
  canRestart: false,
  ...overrides,
});

export const ULTRAS_NOTES = Object.freeze([
  'Ultrasプランは毎月自動で更新されます。',
  '毎月の請求額は$9.00です。',
  '解約は設定のプランからいつでも行えます。',
]);

export const ultrasCheckout = (): CheckoutResult =>
  openCheckout({
    kind: 'ULTRAS',
    unitPrice: { amount: 900, currency: 'usd' },
    total: { amount: 900, currency: 'usd' },
    summary: {
      itemName: 'Ultrasプラン',
      quantityLabel: '1か月',
      serviceTiming: '購入の確定後すぐに特典を提供します。',
      additionalNotes: [...ULTRAS_NOTES],
      isSubscription: true,
    },
    acceptUntil: null,
  });

export const settledCheckout = (
  overrides: Partial<CheckoutResult>,
): CheckoutResult => openCheckout({ clientSecret: null, ...overrides });

export const checkoutData = (
  checkout: CheckoutResult,
): ClientCheckoutQuery => ({
  checkout,
});
