import type { AuditTargetKind } from '../../../common-lib/admin/audit-action.ts';
import {
  AUDIT_PERIOD_MAX_DATE,
  AUDIT_PERIOD_MIN_DATE,
} from './audit-period.ts';

export const AUDIT_LOGS_TITLE = '監査ログ';

export const AUDIT_LOGS_DESCRIPTION =
  '管理者が行った操作の記録を、日時の新しい順に表示します。記録から3年を過ぎた監査ログは自動で削除されます。';

export const AUDIT_LOG_LIST_CAPTION = '監査ログの一覧';

export const AUDIT_LOG_EMPTY_MESSAGE = '条件に一致する監査ログはありません。';

export const AUDIT_LOG_COLUMNS = Object.freeze({
  occurredAt: '日時',
  operator: '操作者',
  action: '操作種別',
  target: '対象',
  reason: '理由',
  detail: '詳細',
});

export const NONE_LABEL = 'なし';

export const deletedOperatorLabel = (id: string): string =>
  `削除済みの管理者(ID: ${id})`;

export const unlistedOperatorLabel = (id: string): string =>
  `一覧に無い管理者(ID: ${id})`;

export const AUDIT_TARGET_KIND_LABELS: Readonly<
  Record<AuditTargetKind, string>
> = Object.freeze({
  user: 'ユーザー',
  admin: '管理者',
  product: 'プロダクト',
  comment: 'コメント',
  rating: '評価',
  image: '画像',
  report: '通報',
  inquiry: '問い合わせ',
  sponsorship: 'スポンサー広告',
  'help-article': 'ヘルプ記事',
  category: 'カテゴリ',
  setting: '設定',
});

export const OPERATOR_FILTER_LABEL = '操作者';

export const ALL_OPERATORS_LABEL = 'すべての管理者';

export const ACTION_FILTER_LABEL = '操作種別';

export const ALL_ACTIONS_LABEL = 'すべての操作種別';

export const TARGET_FILTER_LABEL = '対象の識別子';

export const TARGET_FILTER_DESCRIPTION =
  '対象のIDと完全に一致する監査ログを表示します。';

export const FROM_FILTER_LABEL = '開始日';

export const TO_FILTER_LABEL = '終了日';

export const PERIOD_RANGE_MESSAGE = `日付は${AUDIT_PERIOD_MIN_DATE}から${AUDIT_PERIOD_MAX_DATE}までの範囲で入力してください。`;

export const PERIOD_ORDER_MESSAGE =
  '終了日には開始日と同じか後の日付を入力してください。';
