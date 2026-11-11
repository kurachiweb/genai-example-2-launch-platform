import { RETRY_GUIDANCE } from '../../../lib/utilities/messages/state-messages.ts';

export const HELP_TOP_TITLE = 'ヘルプ';

export const HELP_SEARCH_FORM_LABEL = 'ヘルプ記事';

export const HELP_SEARCH_PLACEHOLDER = 'タイトル・サブタイトル・本文で検索';

export const HELP_PINNED_LABEL = 'ピン留め';

export const HELP_TOP_LOADING_LABEL = 'ヘルプ記事の一覧を読み込み中';

export const HELP_TOP_EMPTY_TITLE = 'ヘルプ記事はまだありません。';

export const HELP_TOP_ERROR_MESSAGE =
  `ヘルプを読み込めませんでした。${RETRY_GUIDANCE}` as const;

export const helpSearchResultsHeading = (query: string): string =>
  `「${query}」の検索結果`;

export const helpSearchResultCount = (formattedCount: string): string =>
  `${formattedCount}件`;

export const helpSearchNoResults = (query: string): string =>
  `「${query}」に一致するヘルプ記事はありません。`;

export const HELP_ALL_ARTICLES_LABEL = 'すべてのヘルプ記事を見る';

export const HELP_SEARCH_COUNT_LOADING = '読み込み中…';

export const HELP_TABLE_OF_CONTENTS_LABEL = '目次';
