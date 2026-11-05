import { describe, expect, test } from 'bun:test';

import {
  EMAIL_REQUEST_STATUSES,
  PURCHASE_STATUSES,
  REFUND_REQUEST_STATUSES,
  REJECTION_REASONS,
} from './purchase-states.ts';

describe('PURCHASE_STATUSES', () => {
  test('未完了・処理中・確定・拒否・失効・置き換えの6値を持つ', () => {
    expect([...PURCHASE_STATUSES]).toEqual([
      'open',
      'processing',
      'fulfilled',
      'rejected',
      'expired',
      'superseded',
    ]);
  });

  test('一覧は変更できない', () => {
    expect(Object.isFrozen(PURCHASE_STATUSES)).toBe(true);
  });
});

describe('REJECTION_REASONS', () => {
  test('反映の期限切れ・対象外・重複の3値を持つ', () => {
    expect([...REJECTION_REASONS]).toEqual(['late', 'ineligible', 'duplicate']);
  });

  test('一覧は変更できない', () => {
    expect(Object.isFrozen(REJECTION_REASONS)).toBe(true);
  });
});

describe('REFUND_REQUEST_STATUSES', () => {
  test('依頼・送信済み・成功・失敗・取り消しの5値を持つ', () => {
    expect([...REFUND_REQUEST_STATUSES]).toEqual([
      'requested',
      'submitted',
      'succeeded',
      'failed',
      'canceled',
    ]);
  });

  test('一覧は変更できない', () => {
    expect(Object.isFrozen(REFUND_REQUEST_STATUSES)).toBe(true);
  });
});

describe('EMAIL_REQUEST_STATUSES', () => {
  test('不要・依頼待ち・依頼済み・送らないの4値を持つ', () => {
    expect([...EMAIL_REQUEST_STATUSES]).toEqual([
      'none',
      'pending',
      'requested',
      'skipped',
    ]);
  });

  test('一覧は変更できない', () => {
    expect(Object.isFrozen(EMAIL_REQUEST_STATUSES)).toBe(true);
  });
});
