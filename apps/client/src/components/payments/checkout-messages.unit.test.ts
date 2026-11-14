import { describe, expect, test } from 'bun:test';

import { refundReasonTextOf } from './checkout-messages.ts';

describe('全額返金した理由の文言', () => {
  test.each([
    [
      'LATE',
      '返金の理由: お支払いの確認が、購入を反映できる期限に間に合いませんでした。',
    ],
    [
      'INELIGIBLE',
      '返金の理由: お支払いを確認した時点で、購入の対象が購入できない状態になっていました。',
    ],
    [
      'DUPLICATE',
      '返金の理由: 同じ購入の対象へのお支払いが既に確定していたため、重ねてのお支払いとなりました。',
    ],
  ] as const)(
    '拒否の理由%sは「返金の理由: 」に続けて共用部品の理由の文を示す',
    (reason, expected) => {
      expect(refundReasonTextOf(reason)).toBe(expected);
    },
  );
});
