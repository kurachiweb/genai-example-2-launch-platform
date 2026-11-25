import type { SponsorshipStartNoticeInput } from '../../../../../lib/core/email/kinds/sponsorship.ts';

type NoticeSubject = Pick<
  SponsorshipStartNoticeInput,
  'productName' | 'tierLabel'
>;

export const LIST_ACTION_LABEL = '自分の広告一覧を見る';

export const LIST_GUIDE_SENTENCE =
  '掲載状況は、下のボタンから自分の広告一覧で確認できます。';

export const REFUND_TIMING_SENTENCE =
  'お手元に反映されるまで数日かかる場合があります。';

export function startNoticeLead({
  productName,
  tierLabel,
}: NoticeSubject): string {
  return `${productName}のスポンサー広告(${tierLabel})の掲載が始まりました。`;
}

export function endNoticeLead({
  productName,
  tierLabel,
}: NoticeSubject): string {
  return `${productName}のスポンサー広告(${tierLabel})の掲載期間が終了しました。`;
}

export function terminationNoticeLead({
  productName,
  tierLabel,
}: NoticeSubject): string {
  return `${productName}のスポンサー広告(${tierLabel})の掲載を、運営者の判断により終了しました。`;
}

export function unexposedRefundLine(days: number, amount: string): string {
  return `未掲載の${String(days)}日分: ${amount}`;
}

export function stoppedRefundLine(days: number, amount: string): string {
  return `表示を止めた${String(days)}日分: ${amount}`;
}
