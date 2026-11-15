import { describe, expect, test } from 'bun:test';

import { REFUND_POLICY_SUMMARY } from './refund-policy-summary.ts';

describe('REFUND_POLICY_SUMMARY', () => {
  test('決済完了後の返金は原則として行わない旨を示す', () => {
    expect(REFUND_POLICY_SUMMARY).toContain(
      '購入の確定後の返金は原則として行いません',
    );
  });

  test('二重決済とシステム障害で役務を提供できなかった場合は返金する旨を示す', () => {
    expect(REFUND_POLICY_SUMMARY).toContain('二重のお支払い');
    expect(REFUND_POLICY_SUMMARY).toContain(
      'システムの障害により役務を提供できなかった場合',
    );
  });

  test('詳細は法的通知の返金ポリシーを参照するよう案内する', () => {
    expect(REFUND_POLICY_SUMMARY).toContain('法的通知の返金ポリシー');
  });
});
