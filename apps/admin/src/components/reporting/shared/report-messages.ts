import type { ReportCaseStatus } from '../../../../common-lib/reporting/report-case-rules.ts';
import type { ReportTargetKind } from '../../../../common-lib/reporting/report-rules.ts';
import type {
  InfringementInquiryOutcomeView,
  ReportCaseClosingOperation,
  ReportCaseOutcomeView,
  ReportTargetView,
} from '../../../graphql/admin-reporting-cases.ts';
import {
  hideCommentDialogCopy,
  hideProductDialogCopy,
  type ModerationDialogCopy,
  suspendUserDialogCopy,
  UNREADABLE_USER_LABEL,
} from '../../moderation/shared/moderation-messages.ts';

export type ReportCaseDialogCopy = ModerationDialogCopy;

export const REPORTS_PAGE_COPY = Object.freeze({
  title: '通報',
  description:
    '同じ対象への通報をまとめた案件を、最後の受付日時の新しい順に表示します。',
});

export const REPORT_CASE_PAGE_TITLE = '通報の案件の詳細';

export const UNAVAILABLE_TARGET_LABEL = '表示できない対象';

export const DETACHED_TARGET_LABEL = '削除された対象';

export const UNKNOWN_RESPONSE_TIME_LABEL = '不明';

const countFormat = new Intl.NumberFormat('ja-JP');

export const reportCountLabel = (count: number): string =>
  `${countFormat.format(count)}件`;

export const categoryCountLabel = (name: string, count: number): string =>
  `${name} ${reportCountLabel(count)}`;

const HOUR_SECONDS = 60 * 60;

const DAY_SECONDS = 24 * HOUR_SECONDS;

// 対応期間の目標が日と時間で決まるため、分以下の端数は切り捨てる
export const formatReportElapsed = (elapsedSeconds: number): string => {
  const days = Math.floor(elapsedSeconds / DAY_SECONDS);
  const hours = Math.floor((elapsedSeconds % DAY_SECONDS) / HOUR_SECONDS);
  if (days > 0) {
    return `${String(days)}日${String(hours)}時間`;
  }
  return hours > 0 ? `${String(hours)}時間` : '1時間未満';
};

export const responseTimePrefixOf = (completedAt: string | null): string =>
  completedAt === null ? '対応中' : '対応期間';

const availableTargetLabelOf = ({
  kind,
  handle,
  label,
  productName,
}: ReportTargetView): string => {
  switch (kind) {
    case 'user': {
      const nickname = label ?? UNREADABLE_USER_LABEL;
      return handle === null ? nickname : `${nickname}(@${handle})`;
    }
    case 'product': {
      const name = label ?? UNAVAILABLE_TARGET_LABEL;
      return handle === null ? name : `${name}(${handle})`;
    }
    case 'comment': {
      return productName === null ? 'コメント' : `${productName}へのコメント`;
    }
  }
};

export const reportTargetLabelOf = (target: ReportTargetView): string => {
  if (target.detached) {
    return DETACHED_TARGET_LABEL;
  }
  return target.available
    ? availableTargetLabelOf(target)
    : UNAVAILABLE_TARGET_LABEL;
};

const MEASURE_LABELS: Readonly<Record<ReportTargetKind, string>> =
  Object.freeze({
    user: '停止する',
    product: '非公開にする',
    comment: '非公開にする',
  });

export const reportCaseActionLabel = (
  operation: ReportCaseClosingOperation,
  targetKind: ReportTargetKind,
): string => {
  switch (operation) {
    case 'resolve-with-measure': {
      return MEASURE_LABELS[targetKind];
    }
    case 'resolve-without-measure': {
      return '措置なしで対応済にする';
    }
    case 'reject': {
      return '却下する';
    }
  }
};

// 一覧の行ごとの操作を読み上げで区別できるよう、見えている操作名を含めて対象を示す
export const reportCaseActionName = (
  operation: ReportCaseClosingOperation,
  target: ReportTargetView,
): string => {
  const subject = reportTargetLabelOf(target);
  const label = reportCaseActionLabel(operation, target.kind);
  switch (operation) {
    case 'resolve-with-measure': {
      return `${subject}を${label}`;
    }
    case 'resolve-without-measure': {
      return `${subject}の案件を${label}`;
    }
    case 'reject': {
      return `${subject}の通報を${label}`;
    }
  }
};

const REASON_NOTICE =
  '理由は投稿者と申出者への通知に載ります。個人情報を含めないでください。';

const MEASURE_NOTICE =
  '案件を対応済にし、申出者へ対応結果を通知します。送った通知は取り消せません。';

// 措置の影響はUGC管理の同じ措置の確認の説明を使い、題名だけを通報管理の文言にそろえる
const measureCopyOf = ({
  kind,
  label,
}: ReportTargetView): ModerationDialogCopy => {
  switch (kind) {
    case 'product': {
      return hideProductDialogCopy(label ?? UNAVAILABLE_TARGET_LABEL);
    }
    // APIは通報の案件のコメントの投稿者のニックネームを返さないため、UGC管理のニックネームが読めないコメントと同じ題名にする
    case 'comment': {
      return hideCommentDialogCopy(null);
    }
    case 'user': {
      const nickname = label ?? UNREADABLE_USER_LABEL;
      return {
        ...suspendUserDialogCopy(nickname),
        title: `${nickname}を停止しますか?`,
      };
    }
  }
};

// 確認のダイアログの理由の欄は注記を足す引数を持たず、説明は段落の中に描かれるため、通知と理由の注記も説明の文に含める
export const reportCaseDialogCopyOf = (
  operation: ReportCaseClosingOperation,
  target: ReportTargetView,
): ReportCaseDialogCopy => {
  switch (operation) {
    case 'resolve-with-measure': {
      const { title, description, confirmLabel } = measureCopyOf(target);
      return {
        title,
        description: `${description}${MEASURE_NOTICE}${REASON_NOTICE}`,
        confirmLabel,
      };
    }
    case 'resolve-without-measure': {
      return {
        title: '措置をせずに対応済にしますか?',
        description: `申出者へ対応結果を通知します。送った通知は取り消せません。${REASON_NOTICE}`,
        confirmLabel: '対応済にする',
      };
    }
    case 'reject': {
      return {
        title: 'この通報を却下しますか?',
        description: `投稿者と申出者へ却下を通知します。送った通知は取り消せません。${REASON_NOTICE}`,
        confirmLabel: '却下する',
      };
    }
  }
};

const STATUS_CHANGED_MESSAGES: Readonly<Record<ReportCaseStatus, string>> =
  Object.freeze({
    open: '未対応に戻しました。',
    in_progress: '対応中にしました。',
    resolved: '対応済にしました。',
    rejected: '却下しました。',
  });

export const INQUIRY_SENT_MESSAGE = '照会を送りました。';

export const reportCaseChangedMessage = (
  outcome: ReportCaseOutcomeView | InfringementInquiryOutcomeView,
): string =>
  'status' in outcome
    ? STATUS_CHANGED_MESSAGES[outcome.status]
    : INQUIRY_SENT_MESSAGE;
