import { describe, expect, test } from 'bun:test';

import { isRefundReason } from '../payments/refund-rules.ts';
import { SPONSORSHIP_REFUND_REASONS } from './ports.ts';

describe('SPONSORSHIP_REFUND_REASONS', () => {
  test('強制終了と表示停止の返金の理由を、決済の依頼キーの末尾にも使う値で持つ', () => {
    expect(SPONSORSHIP_REFUND_REASONS).toEqual({
      termination: 'sponsorship_terminated',
      displayStop: 'sponsorship_display_stopped',
    });
  });

  test.each(Object.values(SPONSORSHIP_REFUND_REASONS))(
    '%sは決済の返金の依頼が受け付ける理由の形式に合う',
    (reason) => {
      expect(isRefundReason(reason)).toBe(true);
    },
  );

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(SPONSORSHIP_REFUND_REASONS)).toBe(true);
  });
});
