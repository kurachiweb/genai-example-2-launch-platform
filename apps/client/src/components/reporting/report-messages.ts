import type { ReportTargetKind } from '../../../common-lib/reporting/report-rules.ts';

export const REPORT_DIALOG_TITLES: Readonly<Record<ReportTargetKind, string>> =
  Object.freeze({
    user: 'このユーザーを通報',
    product: 'このプロダクトを通報',
    comment: 'このコメントを通報',
  });

export const REPORT_ACTION_LABELS: Readonly<Record<ReportTargetKind, string>> =
  Object.freeze({
    user: 'このユーザーを通報',
    product: 'このプロダクトを通報',
    comment: '通報',
  });

export const REPORT_MESSAGES = Object.freeze({
  dialogDescription:
    '通報内容は運営チームが確認します。通報者の情報が投稿者に伝わることはありません。',
  categoryLabel: 'カテゴリ',
  reasonLabel: '理由(必須)',
  contactEmailLabel: '連絡先メールアドレス(必須)',
  contactEmailDescription:
    '権利侵害の申出への対応結果をお知らせするために使います。',
  infringementReasonGuide:
    '侵害されている権利、権利者との関係、対象の箇所を書いてください。',
  submit: '通報する',
  cancel: 'キャンセル',
  accepted: '通報を受け付けました。ご協力ありがとうございます。',
  categoriesLoadError: 'カテゴリを読み込めませんでした。',
});
