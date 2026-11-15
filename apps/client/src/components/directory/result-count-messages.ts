export const RESULT_COUNT_LOADING = '読み込み中…';

// 数は表示設定で3桁区切りに整えた文字列
export const singlePageCountText = (total: string): string => `${total}件`;

export const pagedCountText = (
  total: string,
  first: string,
  last: string,
): string => `${total}件中${first}〜${last}件`;
