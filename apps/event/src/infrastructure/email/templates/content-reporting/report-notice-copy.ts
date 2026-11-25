import type { ReportTargetKind } from '../../../../../common-lib/reporting/report-rules.ts';

export const CONTACT_ACTION_LABEL = 'お問い合わせ';

export const REPORT_OUTCOME_SUBJECT = '通報の対応結果についてのお知らせ';

export const INFRINGEMENT_INQUIRY_SUBJECT =
  '投稿内容の権利侵害についてご確認をお願いします';

export const REPORTER_CLOSING =
  'ご協力ありがとうございました。ご質問がある場合は、下のボタンからお問い合わせください。';

export const POSTER_CLOSING =
  'この通報により、あなたの投稿の表示は変わりません。ご質問がある場合は、下のボタンからお問い合わせください。';

export const INQUIRY_REPLY_METHOD =
  '回答の方法: 下のボタンからお問い合わせフォームを開き、メッセージに対象のページのURLを明記して回答してください。';

export const INQUIRY_OVERDUE_NOTICE =
  '期限までに回答が無い場合は、運営者の判断でこの投稿の公開を停止することがあります。';

const REPORTER_UNKNOWN_TARGET = '通報いただいた内容';

const POSTER_UNKNOWN_TARGET = 'あなたの投稿';

export interface ReportTargetDisplay {
  readonly targetKind: ReportTargetKind;
  readonly targetLabel: string | null;
}

export type ReportOutcome = 'resolved' | 'rejected';

// コメントの表示名はコメントの対象のプロダクトの名称である
function labelledTarget(kind: ReportTargetKind, label: string): string {
  switch (kind) {
    case 'user':
      return `ユーザー「${label}」`;
    case 'product':
      return `プロダクト『${label}』`;
    case 'comment':
      return `${label}へのコメント`;
  }
}

function posterTarget({
  targetKind,
  targetLabel,
}: ReportTargetDisplay): string {
  if (targetLabel === null) {
    return POSTER_UNKNOWN_TARGET;
  }
  return targetKind === 'user'
    ? 'あなたのプロフィール'
    : labelledTarget(targetKind, targetLabel);
}

function outcomeTail(outcome: ReportOutcome): string {
  return outcome === 'resolved' ? '対応しました。' : '通報を却下しました。';
}

// 表示できない対象の「通報いただいた内容」は「通報いただいた」を重ねずにそのまま主語にする
export function reportOutcomeLead(
  outcome: ReportOutcome,
  { targetKind, targetLabel }: ReportTargetDisplay,
): string {
  const subject =
    targetLabel === null
      ? REPORTER_UNKNOWN_TARGET
      : `通報いただいた${labelledTarget(targetKind, targetLabel)}`;
  return `${subject}について、運営者が確認し、${outcomeTail(outcome)}`;
}

export function reportOutcomeDateLabel(outcome: ReportOutcome): string {
  return outcome === 'resolved' ? '対応日時' : '却下の日時';
}

export function posterRejectionLead(target: ReportTargetDisplay): string {
  return `${posterTarget(target)}への通報について運営者が確認し、通報を却下しました。`;
}

export function infringementInquiryLead(target: ReportTargetDisplay): string {
  return `${posterTarget(target)}について、権利を侵害しているとの申出がありました。次の内容について、ご確認をお願いします。`;
}

export interface ReportExcerptSource {
  readonly targetLabel: string | null;
  readonly excerpt: string | null;
}

// 対象を表示できない時は、残っていた抜粋も載せない
export function shownExcerpt({
  targetLabel,
  excerpt,
}: ReportExcerptSource): string | null {
  return targetLabel === null ? null : excerpt;
}
