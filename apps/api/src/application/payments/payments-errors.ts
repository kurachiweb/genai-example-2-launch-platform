import {
  AppError,
  type AppErrorKind,
} from '../../../lib/core/errors/app-error.ts';
import type { PurchaseOfferDecision } from '../../../lib/core/payments/purchase-kind-contract.ts';

interface PaymentsErrorDefinition {
  readonly kind: AppErrorKind;
  readonly message: string;
}

// 回数制限のrate_limit_exceededは厳密カウンタが、利用者の状態の拒否は利用者の確認の口が、共通の文言で投げる
export const PAYMENTS_ERRORS = Object.freeze({
  checkout_closed: {
    kind: 'unprocessable',
    message: '決済の受付は終了しました。',
  },
  purchase_kind_unavailable: {
    kind: 'unprocessable',
    message: 'この決済は現在ご利用いただけません。',
  },
  payments_unavailable: {
    kind: 'unavailable',
    message:
      '現在、決済をご利用いただけません。閲覧やその他の操作はご利用いただけます。',
  },
  checkout_not_found: {
    kind: 'not_found',
    message: 'お探しの決済は見つかりませんでした。',
  },
  checkout_not_open: {
    kind: 'conflict',
    message: 'この決済は既に完了しているか、受付が終了しています。',
  },
} satisfies Readonly<Record<string, PaymentsErrorDefinition>>);

export type PaymentsErrorCode = keyof typeof PAYMENTS_ERRORS;

export const paymentsError = (code: PaymentsErrorCode): AppError => {
  const { kind, message } = PAYMENTS_ERRORS[code];
  return new AppError({ kind, code, message });
};

// 購入できない理由は購入種別を受け持つ機能が決めるため、そのコードと文言をそのまま画面へ返す
export const purchaseOfferUnavailableError = (
  decision: Extract<PurchaseOfferDecision, { kind: 'unavailable' }>,
): AppError =>
  new AppError({
    kind: 'unprocessable',
    code: decision.code,
    message: decision.message,
  });
