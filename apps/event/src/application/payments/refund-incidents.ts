// 運営者が返金の失敗に気付けるよう、再試行で解消しない失敗だけをエラートラッキングへ知らせる。利用者の情報は持たせない
export type RefundIncident =
  | {
      readonly kind: 'stripe-rejected';
      readonly refundRequestId: string;
      readonly operation:
        'find_refund' | 'create_refund' | 'cancel_subscription';
      readonly stripeErrorCode: string;
    }
  | {
      readonly kind: 'missing-payment-intent';
      readonly refundRequestId: string;
    }
  | {
      // 送り直しの前に作られていた返金が、Stripe上で既に失敗していた
      readonly kind: 'stripe-refund-failed';
      readonly refundRequestId: string;
      readonly stripeRefundId: string;
      readonly failureCode: string | null;
    };

export type RefundIncidentKind = RefundIncident['kind'];

export interface RefundIncidentReporter {
  report(incident: RefundIncident): void;
}
