import { type AuditPeriodInput, toAuditPeriod } from '../audit/audit-period.ts';

export type InquiryPeriodInput = AuditPeriodInput;

export interface InquiryPeriod {
  // この時刻を含む
  readonly receivedFrom?: string;
  // この時刻を含まない
  readonly receivedBefore?: string;
}

// 受付日の期間も監査ログの期間と同じく閲覧者の地域の暦で入力するため、同じ変換で開始日の0時を含み終了日の翌日0時を含まないUTCの範囲にする
export function toInquiryPeriod(
  input: InquiryPeriodInput,
  timeZone: string,
): InquiryPeriod {
  const { occurredFrom, occurredBefore } = toAuditPeriod(input, timeZone);
  return {
    ...(occurredFrom !== undefined && { receivedFrom: occurredFrom }),
    ...(occurredBefore !== undefined && { receivedBefore: occurredBefore }),
  };
}
