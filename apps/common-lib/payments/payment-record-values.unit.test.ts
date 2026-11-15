import { describe, expect, test } from 'bun:test';

import {
  PAYMENT_RECORD_KIND_LABELS,
  PAYMENT_RECORD_KINDS,
  PAYMENT_RECORD_STATUS_LABELS,
  PAYMENT_RECORD_STATUSES,
} from './payment-record-values.ts';

describe('PAYMENT_RECORD_KINDS', () => {
  test('データエクスポートのpayments.jsonのkindの4値を持つ', () => {
    expect([...PAYMENT_RECORD_KINDS]).toEqual([
      'one_time',
      'subscription',
      'refund',
      'dispute',
    ]);
  });

  test('一覧は変更できない', () => {
    expect(Object.isFrozen(PAYMENT_RECORD_KINDS)).toBe(true);
  });
});

describe('PAYMENT_RECORD_STATUSES', () => {
  test('データエクスポートのpayments.jsonのstatusの6値を持つ', () => {
    expect([...PAYMENT_RECORD_STATUSES]).toEqual([
      'succeeded',
      'failed',
      'pending',
      'disputed',
      'dispute_won',
      'dispute_lost',
    ]);
  });

  test('一覧は変更できない', () => {
    expect(Object.isFrozen(PAYMENT_RECORD_STATUSES)).toBe(true);
  });
});

describe('PAYMENT_RECORD_KIND_LABELS', () => {
  test('種類の名前が都度決済・定期課金の請求・返金・チャージバックになる', () => {
    expect(PAYMENT_RECORD_KIND_LABELS).toEqual({
      one_time: '都度決済',
      subscription: '定期課金の請求',
      refund: '返金',
      dispute: 'チャージバック',
    });
  });

  test('名前の対応は変更できない', () => {
    expect(Object.isFrozen(PAYMENT_RECORD_KIND_LABELS)).toBe(true);
  });
});

describe('PAYMENT_RECORD_STATUS_LABELS', () => {
  test('状態の名前がデータエクスポートの説明の呼び方になる', () => {
    expect(PAYMENT_RECORD_STATUS_LABELS).toEqual({
      succeeded: '成功',
      failed: '失敗',
      pending: '処理中',
      disputed: '係争中',
      dispute_won: '勝訴',
      dispute_lost: '敗訴',
    });
  });

  test('名前の対応は変更できない', () => {
    expect(Object.isFrozen(PAYMENT_RECORD_STATUS_LABELS)).toBe(true);
  });
});
