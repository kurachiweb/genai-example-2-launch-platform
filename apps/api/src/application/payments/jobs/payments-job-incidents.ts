export type PaymentsJobIncident =
  | {
      readonly kind: 'reconciliation-failed';
      readonly job: string;
      readonly purchaseId: string;
      readonly error: unknown;
    }
  | {
      readonly kind: 'refund-dispatch-failed';
      readonly job: string;
      readonly refundRequestId: string;
      readonly error: unknown;
    }
  | {
      // 送信の失敗で依頼待ちのまま残った購入確認メールと自動返金の通知。入力を組み立てられない行は対象外になり、ここに現れない
      readonly kind: 'notice-request-failed';
      readonly job: string;
      readonly purchaseIds: readonly string[];
      readonly refundRequestIds: readonly string[];
    };

export type PaymentsJobIncidentKind = PaymentsJobIncident['kind'];

// ジョブは失敗した対象を飛ばして続けるため、定期実行の計装が例外として拾わない失敗をエラートラッキングへ知らせる
export interface PaymentsJobIncidentReporter {
  report(incident: PaymentsJobIncident): void;
}
