export const PAYMENT_RECORD_KINDS = Object.freeze([
  'one_time',
  'subscription',
  'refund',
  'dispute',
] as const);

export type PaymentRecordKind = (typeof PAYMENT_RECORD_KINDS)[number];

export const PAYMENT_RECORD_STATUSES = Object.freeze([
  'succeeded',
  'failed',
  'pending',
  'disputed',
  'dispute_won',
  'dispute_lost',
] as const);

export type PaymentRecordStatus = (typeof PAYMENT_RECORD_STATUSES)[number];

export const PAYMENT_RECORD_KIND_LABELS: Readonly<
  Record<PaymentRecordKind, string>
> = Object.freeze({
  one_time: '都度決済',
  subscription: '定期課金の請求',
  refund: '返金',
  dispute: 'チャージバック',
});

export const PAYMENT_RECORD_STATUS_LABELS: Readonly<
  Record<PaymentRecordStatus, string>
> = Object.freeze({
  succeeded: '成功',
  failed: '失敗',
  pending: '処理中',
  disputed: '係争中',
  dispute_won: '勝訴',
  dispute_lost: '敗訴',
});
