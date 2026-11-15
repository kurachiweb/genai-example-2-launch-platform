export const LEGAL_DOCUMENTS_TITLE = '法務文書';

export const LEGAL_DOCUMENT_LIST_HEADING = '法務文書の一覧';

export const LEGAL_DOCUMENT_LIST_EMPTY_MESSAGE = '法務文書がありません。';

export const LEGAL_DOCUMENT_LIST_COLUMNS = Object.freeze({
  name: '文書',
  latestVersion: '最新版',
  publishedAt: '公開日時',
  draft: '下書き',
  actions: '操作',
});

export const UNPUBLISHED_LABEL = '未公開';

export const NONE_LABEL = 'なし';

export const DRAFT_PRESENT_LABEL = 'あり';

export const EDIT_LEGAL_DOCUMENT_LABEL = '編集';

export const OPEN_PUBLIC_PAGE_LABEL = '公開ページを開く';

export const editLegalDocumentName = (documentLabel: string): string =>
  `${documentLabel}を${EDIT_LEGAL_DOCUMENT_LABEL}`;

export const openPublicPageName = (documentLabel: string): string =>
  `${documentLabel}の${OPEN_PUBLIC_PAGE_LABEL}`;
