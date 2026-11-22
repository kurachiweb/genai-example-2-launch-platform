export const REPORT_LIST_CAPTION = '通報の案件';

export const REPORT_LIST_EMPTY_MESSAGE = '該当する通報はありません。';

export const REPORT_LIST_COLUMNS = Object.freeze({
  target: '対象',
  reportCount: '件数',
  categoryCounts: 'カテゴリごとの件数',
  status: '対応ステータス',
  firstReportedAt: '最初の受付日時',
  lastReportedAt: '最後の受付日時',
  responseTime: '対応期間',
  actions: '操作',
});

export const REPORT_FILTER_LABELS = Object.freeze({
  status: '対応ステータス',
  allStatuses: 'すべてのステータス',
  target: '対象の種類',
  allTargets: 'すべての種類',
  category: 'カテゴリ',
  allCategories: 'すべてのカテゴリ',
  from: '受付日の開始日',
  to: '受付日の終了日',
});
