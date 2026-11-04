export const LEGAL_REVISION_TABLE_HEADING = '改訂履歴';

export const LEGAL_REVISION_TABLE_EMPTY_MESSAGE =
  'まだ公開した版はありません。';

export const LEGAL_REVISION_COLUMNS = Object.freeze({
  version: '版',
  publishedAt: '公開日時',
  changeSummary: '変更概要',
  publishedBy: '公開した管理者',
  actions: '操作',
});

export const SHOW_VERSION_LABEL = '表示';

export const VIEW_ON_PUBLIC_PAGE_LABEL = '公開ページで見る';

export const showVersionName = (versionLabel: string): string =>
  `${versionLabel}を${SHOW_VERSION_LABEL}`;

export const viewVersionOnPublicPageName = (versionLabel: string): string =>
  `${versionLabel}を${VIEW_ON_PUBLIC_PAGE_LABEL}`;
