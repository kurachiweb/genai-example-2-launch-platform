import type { SponsorshipRefundStatus } from '../../graphql/generated/graphql.ts';

export const TERMINATE_DIALOG_TITLE = 'スポンサー広告の強制終了';

export const TERMINATE_CONFIRM_LABEL = '強制終了する';

// 説明の文は日数と金額の要素を挟むため、要素の前後の文字で持つ
export const TERMINATION_ESTIMATE_TEXT = Object.freeze({
  beforeUnexposedDays: '未掲載日数',
  beforeRefundEstimate: '日・返金目安額',
  beforeAmountPaid: '(支払った金額',
  beforeDays: '・',
  after: '日間)。',
});

export const TERMINATION_STOP_REFUND_TEXT = Object.freeze({
  beforeStoppedDays: 'これまでの表示停止',
  beforeStopRefundAmount: '日分',
  after: '。',
});

export const TERMINATION_AUTO_REFUND_NOTICE =
  '強制終了を確定すると、これらの金額が自動で返金されます。';

export const terminationResultTitleOf = (id: string): string =>
  `申込${id}の強制終了の結果`;

export const TERMINATION_RESULT_LABELS = Object.freeze({
  terminatedOn: '強制終了日',
  unexposedDays: '未掲載日数',
  refundEstimate: '返金目安額',
  stopRefundAmount: '表示停止の返金額',
  requested: '依頼した返金額',
  purchaseId: '購入ID',
});

export const terminationDaysLabel = (days: number): string =>
  `${String(days)}日`;

export const REMAINING_FULL_REFUND_LABEL = '(残りの全額)';

export const REFUND_RESULT_MESSAGES: Readonly<
  Record<SponsorshipRefundStatus, string>
> = Object.freeze({
  REQUESTED: '自動の返金を依頼しました。',
  ALREADY_REFUNDED:
    '返金できる残りが無いため、自動の返金を依頼しませんでした。Stripeのダッシュボードで返金の状況を確かめてください。',
  REJECTED:
    '自動の返金を依頼できませんでした。Stripeのダッシュボードで対応してください。',
});

export const COPY_PURCHASE_ID_LABEL = '購入IDをコピー';

export const PURCHASE_ID_COPIED = '購入IDをコピーしました。';

export const PURCHASE_ID_COPY_FAILED = '購入IDをコピーできませんでした。';
