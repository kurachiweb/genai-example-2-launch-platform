import { describe, expect, expectTypeOf, test } from 'bun:test';

import { PAYMENT_CURRENCY } from '../../../common-lib/payments/money.ts';
import {
  PAYMENT_RECORD_KINDS,
  PAYMENT_RECORD_STATUSES,
  type PaymentRecordKind,
  type PaymentRecordStatus,
} from '../../../common-lib/payments/payment-record-values.ts';
import {
  PURCHASE_KINDS,
  type PurchaseKind,
} from '../../../common-lib/payments/purchase-kinds.ts';
import {
  EMAIL_REQUEST_STATUSES,
  PURCHASE_STATUSES,
  REFUND_REQUEST_STATUSES,
  REJECTION_REASONS,
  type EmailRequestStatus,
  type PurchaseStatus,
  type RefundRequestStatus,
  type RejectionReason,
} from '../../../common-lib/payments/purchase-states.ts';
import {
  PAYMENT_CURRENCY_VALUES,
  PAYMENT_EMAIL_REQUEST_STATUS_VALUES,
  PAYMENT_RECORD_KIND_VALUES,
  PAYMENT_RECORD_STATUS_VALUES,
  PURCHASE_KIND_VALUES,
  PURCHASE_STATUS_VALUES,
  REFUND_REQUEST_STATUS_VALUES,
  REJECTION_REASON_VALUES,
} from '../../../db/schema/payments/index.ts';
import { paymentPriceSnapshots } from '../../../db/schema/payments/payment-price-snapshots.ts';
import { paymentPurchases } from '../../../db/schema/payments/payment-purchases.ts';
import { paymentRecords } from '../../../db/schema/payments/payment-records.ts';
import { paymentRefunds } from '../../../db/schema/payments/payment-refunds.ts';

// 共用部品とドメイン層はDBディレクトリを読み込めないため、テーブル定義に直書きした種類と状態の値と共用部品の一覧の一致を、DBのスキーマを読み込めるapplication層で確かめる
describe('決済のテーブル定義の種類と状態の値の一覧', () => {
  test.each([
    ['購入の購入種別', paymentPurchases.kind.enumValues, PURCHASE_KINDS],
    ['決済履歴の購入種別', paymentRecords.purpose.enumValues, PURCHASE_KINDS],
    ['購入の状態', paymentPurchases.status.enumValues, PURCHASE_STATUSES],
    [
      '購入の拒否の理由',
      paymentPurchases.rejectionReason.enumValues,
      REJECTION_REASONS,
    ],
    [
      '購入確認メールの依頼の状態',
      paymentPurchases.confirmationEmailStatus.enumValues,
      EMAIL_REQUEST_STATUSES,
    ],
    [
      '返金の依頼の状態',
      paymentRefunds.status.enumValues,
      REFUND_REQUEST_STATUSES,
    ],
    [
      '自動返金の通知メールの依頼の状態',
      paymentRefunds.noticeStatus.enumValues,
      EMAIL_REQUEST_STATUSES,
    ],
    ['決済履歴の種類', paymentRecords.kind.enumValues, PAYMENT_RECORD_KINDS],
    [
      '決済履歴の状態',
      paymentRecords.status.enumValues,
      PAYMENT_RECORD_STATUSES,
    ],
    ['決済履歴の通貨', paymentRecords.currency.enumValues, [PAYMENT_CURRENCY]],
    [
      '価格の一時保持の通貨',
      paymentPriceSnapshots.currency.enumValues,
      [PAYMENT_CURRENCY],
    ],
  ])(
    '%sの列の値が共用部品の一覧と同じ順で同じになる',
    (_, enumValues, sharedValues) => {
      expect<readonly string[]>([...enumValues]).toEqual([...sharedValues]);
    },
  );

  test.each([
    ['購入種別', PURCHASE_KIND_VALUES, PURCHASE_KINDS],
    ['購入の状態', PURCHASE_STATUS_VALUES, PURCHASE_STATUSES],
    ['購入の拒否の理由', REJECTION_REASON_VALUES, REJECTION_REASONS],
    [
      'メールの依頼の状態',
      PAYMENT_EMAIL_REQUEST_STATUS_VALUES,
      EMAIL_REQUEST_STATUSES,
    ],
    ['返金の依頼の状態', REFUND_REQUEST_STATUS_VALUES, REFUND_REQUEST_STATUSES],
    ['決済履歴の種類', PAYMENT_RECORD_KIND_VALUES, PAYMENT_RECORD_KINDS],
    ['決済履歴の状態', PAYMENT_RECORD_STATUS_VALUES, PAYMENT_RECORD_STATUSES],
    ['通貨', PAYMENT_CURRENCY_VALUES, [PAYMENT_CURRENCY]],
  ])(
    'テーブル定義がエクスポートする%sの一覧が共用部品の一覧と同じ順で同じになる',
    (_, tableValues, sharedValues) => {
      expect<readonly string[]>([...tableValues]).toEqual([...sharedValues]);
    },
  );

  test('種類と状態の列の値の型が共用部品の型と同じになる', () => {
    expectTypeOf<
      (typeof paymentPurchases.kind.enumValues)[number]
    >().toEqualTypeOf<PurchaseKind>();
    expectTypeOf<
      (typeof paymentRecords.purpose.enumValues)[number]
    >().toEqualTypeOf<PurchaseKind>();
    expectTypeOf<
      (typeof paymentPurchases.status.enumValues)[number]
    >().toEqualTypeOf<PurchaseStatus>();
    expectTypeOf<
      (typeof paymentPurchases.rejectionReason.enumValues)[number]
    >().toEqualTypeOf<RejectionReason>();
    expectTypeOf<
      (typeof paymentPurchases.confirmationEmailStatus.enumValues)[number]
    >().toEqualTypeOf<EmailRequestStatus>();
    expectTypeOf<
      (typeof paymentRefunds.status.enumValues)[number]
    >().toEqualTypeOf<RefundRequestStatus>();
    expectTypeOf<
      (typeof paymentRefunds.noticeStatus.enumValues)[number]
    >().toEqualTypeOf<EmailRequestStatus>();
    expectTypeOf<
      (typeof paymentRecords.kind.enumValues)[number]
    >().toEqualTypeOf<PaymentRecordKind>();
    expectTypeOf<
      (typeof paymentRecords.status.enumValues)[number]
    >().toEqualTypeOf<PaymentRecordStatus>();
    expectTypeOf<
      (typeof paymentRecords.currency.enumValues)[number]
    >().toEqualTypeOf<typeof PAYMENT_CURRENCY>();
    expectTypeOf<
      (typeof paymentPriceSnapshots.currency.enumValues)[number]
    >().toEqualTypeOf<typeof PAYMENT_CURRENCY>();
  });
});
