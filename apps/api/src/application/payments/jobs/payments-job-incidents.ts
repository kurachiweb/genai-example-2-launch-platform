export type PaymentsJobIncident =
  | {
      readonly kind: 'reconciliation-failed';
      readonly job: string;
      readonly purchaseId: string;
      readonly error: unknown;
    }
  | {
      // 時間の上限に達して突合しなかった購入の件数。残りは次の起動の突合と日次の確認が拾う
      readonly kind: 'reconciliation-time-limit-reached';
      readonly job: string;
      readonly remaining: number;
    }
  | {
      readonly kind: 'refund-dispatch-failed';
      readonly job: string;
      readonly refundRequestId: string;
      readonly error: unknown;
    }
  | {
      // 送信から時間が経っても依頼中のまま残り、送り直した返金の依頼。デッドレターになった依頼が含まれ得る
      readonly kind: 'refund-redispatched';
      readonly job: string;
      readonly refundRequestIds: readonly string[];
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
