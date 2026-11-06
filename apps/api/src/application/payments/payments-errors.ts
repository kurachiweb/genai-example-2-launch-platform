import {
  CHECKOUT_SESSION_ID_MESSAGES,
  type CheckoutSessionIdIssue,
  PAYMENT_HISTORY_PAGE_SIZE_MESSAGES,
  type PaymentHistoryPageSizeIssue,
} from '../../../common-lib/payments/payment-input-rules.ts';
import { PAYMENTS_UNAVAILABLE_MESSAGE } from '../../../common-lib/payments/payments-unavailable-texts.ts';
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
    message: PAYMENTS_UNAVAILABLE_MESSAGE,
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

const VALIDATION_ERROR_MESSAGE = '入力内容を確認してください。';

export const checkoutSessionIdRejectedError = (
  issue: CheckoutSessionIdIssue,
): AppError =>
  new AppError({
    kind: 'bad_request',
    code: 'validation_error',
    message: VALIDATION_ERROR_MESSAGE,
    details: [
      {
        field: 'sessionId',
        code: issue,
        message: CHECKOUT_SESSION_ID_MESSAGES[issue],
      },
    ],
  });

export const paymentHistoryPageSizeRejectedError = (
  issue: PaymentHistoryPageSizeIssue,
): AppError =>
  new AppError({
    kind: 'bad_request',
    code: 'validation_error',
    message: VALIDATION_ERROR_MESSAGE,
    details: [
      {
        field: 'first',
        code: issue,
        message: PAYMENT_HISTORY_PAGE_SIZE_MESSAGES[issue],
      },
    ],
  });
