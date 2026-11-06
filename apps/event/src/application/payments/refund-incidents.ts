// 運営者が返金の失敗に気付けるよう、再試行で解消しない失敗だけをエラートラッキングへ知らせる。利用者の情報は持たせない
export type RefundIncident =
  | {
      readonly kind: 'stripe-rejected';
      readonly refundRequestId: string;
      readonly operation: 'create_refund' | 'cancel_subscription';
      readonly stripeErrorCode: string;
    }
  | {
      readonly kind: 'missing-payment-intent';
      readonly refundRequestId: string;
    };

export type RefundIncidentKind = RefundIncident['kind'];

export interface RefundIncidentReporter {
  report(incident: RefundIncident): void;
}
