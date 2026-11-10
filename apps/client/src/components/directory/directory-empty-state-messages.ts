export const FILTERED_EMPTY_TITLE = '条件に一致するプロダクトはありません。';

export const FILTERED_EMPTY_DESCRIPTION =
  'キーワードを変えるか、絞り込みを解除してお試しください。';

export const NO_ENTRIES_TITLE =
  'ディレクトリに掲載されたプロダクトはまだありません。';

export const NO_ENTRIES_DESCRIPTION =
  '予選マッチに勝利したプロダクトがここに並びます。最初の勝者を目指して、ローンチを予約しましょう。';

export const OUT_OF_RANGE_TITLE = 'このページにはプロダクトがありません。';

// ページ数は表示設定で3桁区切りに整えた文字列
export const outOfRangeDescription = (pageCount: string): string =>
  `一覧は全${pageCount}ページです。1ページ目から探してみましょう。`;

export const FIRST_PAGE_LABEL = '1ページ目へ';

export const keywordConditionLabel = (q: string): string =>
  `キーワード「${q}」`;

export const categoryConditionLabel = (categoryName: string): string =>
  `カテゴリ「${categoryName}」`;

// 期間の表示は日付を<time>要素で示すため、前後の文字だけを持つ
export const PERIOD_CONDITION_LABEL = Object.freeze({
  before: '期間「',
  after: '」',
});

export const CLEAR_CONDITION_SUFFIX = 'を解除';

export const CLEAR_ALL_CONDITIONS_LABEL = '条件をすべて解除';
