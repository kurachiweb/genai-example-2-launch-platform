import { describe, expect, test } from 'bun:test';

import { REJECTION_REASONS } from './purchase-states.ts';
import { REFUND_REASON_TEXTS } from './refund-reason-texts.ts';

describe('REFUND_REASON_TEXTS', () => {
  test('権利を付与できなかった理由のすべてに、利用者へ示す返金の理由の文がある', () => {
    expect(Object.keys(REFUND_REASON_TEXTS).toSorted()).toEqual(
      [...REJECTION_REASONS].toSorted(),
    );
  });

  test.each([
    ['late', 'お支払いの確認が、購入を反映できる期限に間に合いませんでした。'],
    [
      'ineligible',
      'お支払いを確認した時点で、購入の対象が購入できない状態になっていました。',
    ],
    [
      'duplicate',
      '同じ購入の対象へのお支払いが既に確定していたため、重ねてのお支払いとなりました。',
    ],
  ] as const)('%sの理由は文言規則の文にする', (reason, text) => {
    expect(REFUND_REASON_TEXTS[reason]).toBe(text);
  });

  test('凍結されていて書き換えられない', () => {
    expect(Object.isFrozen(REFUND_REASON_TEXTS)).toBe(true);
  });
});
