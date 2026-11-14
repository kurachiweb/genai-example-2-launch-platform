import { describe, expect, test } from 'bun:test';

import { CHECKOUT_CONSENT_TEXT } from '../../../../common-lib/payments/checkout-consent.ts';
import {
  PAYMENTS_AUTOMATIC_REFUND_KIND,
  PAYMENTS_EMAIL_KINDS,
  PAYMENTS_PURCHASE_CONFIRMATION_KIND,
} from './payments.ts';

const PAYMENT_HISTORY_URL = 'https://client.example/settings/billing';

const CONFIRMATION_FIELDS = {
  nickname: '山田',
  itemName: 'Ultrasプラン',
  quantityLabel: '1か月',
  amount: 1200,
  purchasedAt: '2026-11-02T07:40:00.000Z',
  serviceTiming: '購入の確定後すぐ',
  additionalNotes: [
    '毎月自動で更新されます。',
    '設定のプランからいつでも解約できます。',
  ],
  consentedAt: '2026-11-02T07:38:00.000Z',
  consentText: CHECKOUT_CONSENT_TEXT,
  paymentHistoryUrl: PAYMENT_HISTORY_URL,
};

const REFUND_FIELDS = {
  nickname: '山田',
  itemName: 'Weekトーナメント参加費',
  quantityLabel: '1件',
  amount: 900,
  reason: 'late' as const,
  purchasedAt: '2026-11-02T07:40:00.000Z',
  refundedAt: '2026-11-02T08:10:00.000Z',
  paymentHistoryUrl: PAYMENT_HISTORY_URL,
};

function confirmationWith(key: string, value: unknown): unknown {
  return { ...CONFIRMATION_FIELDS, [key]: value };
}

function refundWith(key: string, value: unknown): unknown {
  return { ...REFUND_FIELDS, [key]: value };
}

function acceptsConfirmation(input: unknown): boolean {
  return PAYMENTS_PURCHASE_CONFIRMATION_KIND.inputSchema.safeParse(input)
    .success;
}

function acceptsRefund(input: unknown): boolean {
  return PAYMENTS_AUTOMATIC_REFUND_KIND.inputSchema.safeParse(input).success;
}

const INVALID_TEXTS = ['', undefined, null, 1];

const INVALID_AMOUNTS = [0, -100, 12.5, 10_000_001, '1200', undefined];

const INVALID_DATE_TIMES = [
  '',
  '2026-11-02',
  '2026-11-02T16:40:00+09:00',
  '2026-13-01T00:00:00Z',
  1_793_000_000_000,
  new Date('2026-11-02T07:40:00.000Z'),
  undefined,
];

const INVALID_URLS = [
  '',
  'http://client.example/settings/billing',
  'javascript:alert(1)',
  '/settings/billing',
  undefined,
];

describe('メール種別payments.purchase-confirmation', () => {
  test('トランザクションメールの凍結した種別である', () => {
    expect(PAYMENTS_PURCHASE_CONFIRMATION_KIND.name).toBe(
      'payments.purchase-confirmation',
    );
    expect(PAYMENTS_PURCHASE_CONFIRMATION_KIND.category).toBe('transactional');
    expect(Object.isFrozen(PAYMENTS_PURCHASE_CONFIRMATION_KIND)).toBe(true);
  });

  test('購入の内容・金額・日時・追加事項・同意・決済履歴のURLを受け付け、他の項目を取り除く', () => {
    const result = PAYMENTS_PURCHASE_CONFIRMATION_KIND.inputSchema.safeParse({
      ...CONFIRMATION_FIELDS,
      to: 'someone@mail.example',
      stripeCustomerId: 'cus_123',
    });

    expect(result).toEqual({ success: true, data: CONFIRMATION_FIELDS });
  });

  test('追加事項の無い購入を空の一覧で受け付ける', () => {
    expect(acceptsConfirmation(confirmationWith('additionalNotes', []))).toBe(
      true,
    );
  });

  test('検証した結果をもう一度検証しても同じ値になる', () => {
    const first =
      PAYMENTS_PURCHASE_CONFIRMATION_KIND.inputSchema.parse(
        CONFIRMATION_FIELDS,
      );

    expect(
      PAYMENTS_PURCHASE_CONFIRMATION_KIND.inputSchema.parse(first),
    ).toEqual(first);
  });

  test.each([
    'nickname',
    'itemName',
    'quantityLabel',
    'serviceTiming',
    'consentText',
  ])('文字列の項目%sが空・欠落・文字列以外なら拒否する', (key) => {
    for (const value of INVALID_TEXTS) {
      expect(acceptsConfirmation(confirmationWith(key, value))).toBe(false);
    }
  });

  test.each(INVALID_AMOUNTS)(
    '最小通貨単位の正の整数でない金額%pを拒否する',
    (amount) => {
      expect(acceptsConfirmation(confirmationWith('amount', amount))).toBe(
        false,
      );
    },
  );

  test.each(['purchasedAt', 'consentedAt'])(
    '日時の項目%sがUTCのISO 8601形式でなければ拒否する',
    (key) => {
      for (const value of INVALID_DATE_TIMES) {
        expect(acceptsConfirmation(confirmationWith(key, value))).toBe(false);
      }
    },
  );

  test.each([[''], [1], undefined, null, 'notes'])(
    '空の文字列や文字列以外を含む追加事項%pを拒否する',
    (notes) => {
      expect(
        acceptsConfirmation(confirmationWith('additionalNotes', notes)),
      ).toBe(false);
    },
  );

  test.each(INVALID_URLS)(
    'https:かhttp://localhostで始まらない決済履歴のURL%pを拒否する',
    (url) => {
      expect(
        acceptsConfirmation(confirmationWith('paymentHistoryUrl', url)),
      ).toBe(false);
    },
  );
});

describe('メール種別payments.automatic-refund', () => {
  test('トランザクションメールの凍結した種別である', () => {
    expect(PAYMENTS_AUTOMATIC_REFUND_KIND.name).toBe(
      'payments.automatic-refund',
    );
    expect(PAYMENTS_AUTOMATIC_REFUND_KIND.category).toBe('transactional');
    expect(Object.isFrozen(PAYMENTS_AUTOMATIC_REFUND_KIND)).toBe(true);
  });

  test('購入の内容・返金した金額・理由・日時・決済履歴のURLを受け付け、他の項目を取り除く', () => {
    const result = PAYMENTS_AUTOMATIC_REFUND_KIND.inputSchema.safeParse({
      ...REFUND_FIELDS,
      to: 'someone@mail.example',
      requestKey: 'reflection:late:01JBX3M5Q4ZQ7Y8W9V0T1S2R3P',
    });

    expect(result).toEqual({ success: true, data: REFUND_FIELDS });
  });

  test.each(['late', 'ineligible', 'duplicate'])(
    '自動返金の理由%sを受け付ける',
    (reason) => {
      expect(acceptsRefund(refundWith('reason', reason))).toBe(true);
    },
  );

  test.each(['', 'entitlement_lost', 'requested_by_customer', 'LATE', 1])(
    '自動返金の理由でない値%pを拒否する',
    (reason) => {
      expect(acceptsRefund(refundWith('reason', reason))).toBe(false);
    },
  );

  test('検証した結果をもう一度検証しても同じ値になる', () => {
    const first =
      PAYMENTS_AUTOMATIC_REFUND_KIND.inputSchema.parse(REFUND_FIELDS);

    expect(PAYMENTS_AUTOMATIC_REFUND_KIND.inputSchema.parse(first)).toEqual(
      first,
    );
  });

  test.each(['nickname', 'itemName', 'quantityLabel'])(
    '文字列の項目%sが空・欠落・文字列以外なら拒否する',
    (key) => {
      for (const value of INVALID_TEXTS) {
        expect(acceptsRefund(refundWith(key, value))).toBe(false);
      }
    },
  );

  test.each(INVALID_AMOUNTS)(
    '最小通貨単位の正の整数でない返金の金額%pを拒否する',
    (amount) => {
      expect(acceptsRefund(refundWith('amount', amount))).toBe(false);
    },
  );

  test.each(['purchasedAt', 'refundedAt'])(
    '日時の項目%sがUTCのISO 8601形式でなければ拒否する',
    (key) => {
      for (const value of INVALID_DATE_TIMES) {
        expect(acceptsRefund(refundWith(key, value))).toBe(false);
      }
    },
  );

  test.each(INVALID_URLS)(
    'https:かhttp://localhostで始まらない決済履歴のURL%pを拒否する',
    (url) => {
      expect(acceptsRefund(refundWith('paymentHistoryUrl', url))).toBe(false);
    },
  );
});

describe('PAYMENTS_EMAIL_KINDS', () => {
  test('購入確認と自動返金の2種をこの順で凍結して持つ', () => {
    expect(PAYMENTS_EMAIL_KINDS).toEqual([
      PAYMENTS_PURCHASE_CONFIRMATION_KIND,
      PAYMENTS_AUTOMATIC_REFUND_KIND,
    ]);
    expect(Object.isFrozen(PAYMENTS_EMAIL_KINDS)).toBe(true);
  });
});
