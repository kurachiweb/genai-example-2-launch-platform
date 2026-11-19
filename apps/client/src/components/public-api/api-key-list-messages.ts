export const API_DOCS_HREF = '/api-docs';

export const API_KEY_LIST_MESSAGES = Object.freeze({
  listLabel: 'APIキーの一覧',
  loadingLabel: 'APIキーを読み込み中',
  emptyTitle: 'APIキーはまだありません。',
  emptyDescription:
    'APIキーを発行すると、公開APIでプロダクト・ローンチ履歴・Upvote・コメント・評価・公開プロフィールを読み取り、自分のプロフィールとプロダクトの説明文を更新できます。',
  apiDocsLink: 'APIドキュメントを見る',
  loadError: 'APIキーを読み込めませんでした。時間をおいて再度お試しください。',
  loadMore: 'さらに表示',
  loadingMore: '読み込み中',
  scopesLabel: '権限',
  createdAtLabel: '発行日時',
  noScopes: '権限なし',
  edit: '編集',
  reissue: '再発行',
  delete: '削除',
});

export const editApiKeyLabelOf = (name: string): string => `${name}を編集`;

export const reissueApiKeyLabelOf = (name: string): string => `${name}を再発行`;

export const deleteApiKeyLabelOf = (name: string): string => `${name}を削除`;
