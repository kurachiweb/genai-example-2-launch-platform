import {
  INQUIRY_MESSAGE_MAX,
  INQUIRY_RESPONSE_DAYS,
  type ManualStatusChangeKind,
} from '../../../../common-lib/reporting/report-case-rules.ts';
import { formatCount } from '../../../../lib/utilities/messages/length-limit-messages.ts';

export const REPORT_CASE_DETAIL_COPY = Object.freeze({
  backToList: '通報の一覧へ',
  notFound: '通報の案件が見つかりません。',
  sections: Object.freeze({
    target: '対象',
    status: '対応の状況',
    inquiry: '権利侵害の照会',
    operations: '操作',
    reports: '通報',
  }),
  items: Object.freeze({
    targetKind: '対象の種類',
    status: '対応ステータス',
    statusChangedAt: '最後に変わった日時',
    reportCount: '通報の件数',
    categoryCounts: 'カテゴリごとの件数',
    firstReportedAt: '最初の受付日時',
    lastReportedAt: '最後の受付日時',
    responseTime: '対応期間',
    resolution: '完了の種類',
    closingReason: '完了の理由',
    closedAt: '完了の日時',
  }),
  openClientPage: '利用者側のページを開く',
  openAdminPage: '管理画面で開く',
});

export const REPORT_LIST_COPY = Object.freeze({
  label: '通報の一覧',
  items: Object.freeze({
    category: 'カテゴリ',
    reason: '理由',
    reportedAt: '受付日時',
    reporter: '通報者',
  }),
  guest: '未ログイン',
  withContact: '連絡先あり',
  withoutContact: '連絡先なし',
  empty: '該当する通報はありません。',
});

export const REPORT_INQUIRY_COPY = Object.freeze({
  lastInquiry: '最後の照会',
  message: '照会の内容',
  deadline: '回答の期限',
  overdue: '回答の期限を過ぎています',
  none: '照会はまだ送っていません。',
  send: '照会を送る',
});

export const INFRINGEMENT_INQUIRY_DIALOG_COPY = Object.freeze({
  title: '投稿者へ照会のメールを送りますか?',
  description: `回答の期限は送信から${String(INQUIRY_RESPONSE_DAYS)}日です。`,
  messageLabel: '照会の内容(必須)',
  messageNotice: '申出者や第三者の個人情報を含めないでください。',
  confirm: '照会を送る',
});

export const INQUIRY_MESSAGE_ERROR_MESSAGES = Object.freeze({
  empty: '照会の内容を入力してください。',
  'too-long': `照会の内容は${formatCount(INQUIRY_MESSAGE_MAX)}文字以内で入力してください。`,
});

const STATUS_CHANGE_NOTICE = '手での変更では投稿者と申出者へ通知しません。';

const STATUS_CHANGE_KIND_NOTICES: Readonly<
  Record<ManualStatusChangeKind, string>
> = Object.freeze({
  progress: '',
  close:
    '通知するには、措置・措置なしで対応済にする・却下の操作を使ってください。',
  reopen:
    '完了の日時・措置の種類・完了の理由を消し、まだ送っていない通知を取りやめます。行った措置(非公開化・停止)は取り消されません。取り消す場合は各管理画面で行ってください。',
});

export const REPORT_STATUS_CHANGE_COPY = Object.freeze({
  heading: '対応ステータスの変更',
  nextStatus: '変更後の対応ステータス',
  submit: '対応ステータスを変更',
  confirm: '変更する',
});

export const reportStatusChangeTitle = (statusLabel: string): string =>
  `対応ステータスを${statusLabel}にしますか?`;

export const reportStatusChangeDescription = (
  kind: ManualStatusChangeKind,
): string => `${STATUS_CHANGE_NOTICE}${STATUS_CHANGE_KIND_NOTICES[kind]}`;
