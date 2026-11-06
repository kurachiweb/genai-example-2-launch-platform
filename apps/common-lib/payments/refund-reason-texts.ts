import type { RejectionReason } from './purchase-states.ts';

// 自動返金の通知メール・決済画面・決済後のランディングが、権利を付与できず全額返金した理由として同じ文を示す
export const REFUND_REASON_TEXTS: Readonly<Record<RejectionReason, string>> =
  Object.freeze({
    late: 'お支払いの確認が、購入を反映できる期限に間に合いませんでした。',
    ineligible:
      'お支払いを確認した時点で、購入の対象が購入できない状態になっていました。',
    duplicate:
      '同じ購入の対象へのお支払いが既に確定していたため、重ねてのお支払いとなりました。',
  });
