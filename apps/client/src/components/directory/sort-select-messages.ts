import type { DirectorySort } from '../../../common-lib/directory/directory-query-rules.ts';

export const SORT_SELECT_LABEL = '並び順';

export const SORT_LABELS: Readonly<Record<DirectorySort, string>> =
  Object.freeze({
    relevance: '関連度',
    newest: 'ローンチ日が新しい順',
    oldest: 'ローンチ日が古い順',
    upvotes: 'Upvote数が多い順',
  });

export const RELEVANCE_UNAVAILABLE_REASON =
  '検索キーワードを入力すると選べます';
