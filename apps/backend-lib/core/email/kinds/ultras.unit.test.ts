import { describe, expect, test } from 'bun:test';

import {
  ULTRAS_CANCELLATION_ACCEPTED_KIND,
  ULTRAS_EMAIL_KINDS,
  ULTRAS_PAYMENT_FAILED_KIND,
} from './ultras.ts';

const PLAN_URL = 'https://client.example/settings/plan';

const PAYMENT_FAILED_FIELDS = {
  nickname: '山田',
  planUrl: PLAN_URL,
};

const CANCELLATION_ACCEPTED_FIELDS = {
  nickname: '山田',
  acceptedAt: '2026-11-02T07:40:00.000Z',
  benefitEndsAt: '2026-11-30T07:40:00.000Z',
  planUrl: PLAN_URL,
};

function paymentFailedWith(key: string, value: unknown): unknown {
  return { ...PAYMENT_FAILED_FIELDS, [key]: value };
}

function cancellationAcceptedWith(key: string, value: unknown): unknown {
  return { ...CANCELLATION_ACCEPTED_FIELDS, [key]: value };
}

function acceptsPaymentFailed(input: unknown): boolean {
  return ULTRAS_PAYMENT_FAILED_KIND.inputSchema.safeParse(input).success;
}

function acceptsCancellationAccepted(input: unknown): boolean {
  return ULTRAS_CANCELLATION_ACCEPTED_KIND.inputSchema.safeParse(input).success;
}

const INVALID_TEXTS = ['', undefined, null, 1];

const INVALID_DATE_TIMES = [
  '',
  '2026-11-02',
  '2026-11-02T16:40:00+09:00',
  '2026-13-01T00:00:00Z',
  1_793_000_000_000,
  new Date('2026-11-02T07:40:00.000Z'),
  undefined,
  null,
];

const INVALID_URLS = [
  '',
  'http://client.example/settings/plan',
  'javascript:alert(1)',
  '/settings/plan',
  undefined,
];

describe('メール種別ultras.payment-failed', () => {
  test('トランザクションメールの凍結した種別である', () => {
    expect(ULTRAS_PAYMENT_FAILED_KIND.name).toBe('ultras.payment-failed');
    expect(ULTRAS_PAYMENT_FAILED_KIND.category).toBe('transactional');
    expect(Object.isFrozen(ULTRAS_PAYMENT_FAILED_KIND)).toBe(true);
  });

  test('ニックネームとプラン管理画面のURLを受け付け、他の項目を取り除く', () => {
    const result = ULTRAS_PAYMENT_FAILED_KIND.inputSchema.safeParse({
      ...PAYMENT_FAILED_FIELDS,
      to: 'someone@mail.example',
      stripeSubscriptionId: 'sub_123',
    });

    expect(result).toEqual({ success: true, data: PAYMENT_FAILED_FIELDS });
  });

  test('ローカル環境のプラン管理画面のURLをhttp://localhostで受け付ける', () => {
    expect(
      acceptsPaymentFailed(
        paymentFailedWith('planUrl', 'http://localhost:3000/settings/plan'),
      ),
    ).toBe(true);
  });

  test('検証した結果をもう一度検証しても同じ値になる', () => {
    const first = ULTRAS_PAYMENT_FAILED_KIND.inputSchema.parse(
      PAYMENT_FAILED_FIELDS,
    );

    expect(ULTRAS_PAYMENT_FAILED_KIND.inputSchema.parse(first)).toEqual(first);
  });

  test('ニックネームが空・欠落・文字列以外なら拒否する', () => {
    for (const value of INVALID_TEXTS) {
      expect(acceptsPaymentFailed(paymentFailedWith('nickname', value))).toBe(
        false,
      );
    }
  });

  test.each(INVALID_URLS)(
    'https:かhttp://localhostで始まらないプラン管理画面のURL%pを拒否する',
    (url) => {
      expect(acceptsPaymentFailed(paymentFailedWith('planUrl', url))).toBe(
        false,
      );
    },
  );
});

describe('メール種別ultras.cancellation-accepted', () => {
  test('トランザクションメールの凍結した種別である', () => {
    expect(ULTRAS_CANCELLATION_ACCEPTED_KIND.name).toBe(
      'ultras.cancellation-accepted',
    );
    expect(ULTRAS_CANCELLATION_ACCEPTED_KIND.category).toBe('transactional');
    expect(Object.isFrozen(ULTRAS_CANCELLATION_ACCEPTED_KIND)).toBe(true);
  });

  test('ニックネーム・受け付けた日時・特典の終了日時・プラン管理画面のURLを受け付け、他の項目を取り除く', () => {
    const result = ULTRAS_CANCELLATION_ACCEPTED_KIND.inputSchema.safeParse({
      ...CANCELLATION_ACCEPTED_FIELDS,
      to: 'someone@mail.example',
      cancellationSource: 'customer_portal',
    });

    expect(result).toEqual({
      success: true,
      data: CANCELLATION_ACCEPTED_FIELDS,
    });
  });

  test('検証した結果をもう一度検証しても同じ値になる', () => {
    const first = ULTRAS_CANCELLATION_ACCEPTED_KIND.inputSchema.parse(
      CANCELLATION_ACCEPTED_FIELDS,
    );

    expect(ULTRAS_CANCELLATION_ACCEPTED_KIND.inputSchema.parse(first)).toEqual(
      first,
    );
  });

  test('ニックネームが空・欠落・文字列以外なら拒否する', () => {
    for (const value of INVALID_TEXTS) {
      expect(
        acceptsCancellationAccepted(
          cancellationAcceptedWith('nickname', value),
        ),
      ).toBe(false);
    }
  });

  test.each(['acceptedAt', 'benefitEndsAt'])(
    '日時の項目%sがUTCのISO 8601形式でなければ拒否する',
    (key) => {
      for (const value of INVALID_DATE_TIMES) {
        expect(
          acceptsCancellationAccepted(cancellationAcceptedWith(key, value)),
        ).toBe(false);
      }
    },
  );

  test.each(INVALID_URLS)(
    'https:かhttp://localhostで始まらないプラン管理画面のURL%pを拒否する',
    (url) => {
      expect(
        acceptsCancellationAccepted(cancellationAcceptedWith('planUrl', url)),
      ).toBe(false);
    },
  );
});

describe('ULTRAS_EMAIL_KINDS', () => {
  test('支払いの失敗と解約の受付の2種をこの順で凍結して持つ', () => {
    expect(ULTRAS_EMAIL_KINDS).toEqual([
      ULTRAS_PAYMENT_FAILED_KIND,
      ULTRAS_CANCELLATION_ACCEPTED_KIND,
    ]);
    expect(Object.isFrozen(ULTRAS_EMAIL_KINDS)).toBe(true);
  });
});
