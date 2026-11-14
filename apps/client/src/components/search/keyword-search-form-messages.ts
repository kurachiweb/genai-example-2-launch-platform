export const KEYWORD_SEARCH_INPUT_LABEL = '検索キーワード';

export const KEYWORD_SEARCH_CLEAR_LABEL = '検索キーワードを消去';

export const KEYWORD_SEARCH_SUBMIT_LABEL = '検索';

export const KEYWORD_SEARCH_COUNTER_PREFIX = '文字数';

export const keywordSearchTooLongMessage = (max: number): string =>
  `検索キーワードは${String(max)}文字以内で入力してください。`;
