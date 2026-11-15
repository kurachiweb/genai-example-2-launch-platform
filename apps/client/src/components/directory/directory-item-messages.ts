export const OWN_PRODUCT_BADGE = 'あなたのプロダクト';

// 画面の文字はカテゴリ名だけのため、リンクの名前で絞り込む操作だと伝える
export const categoryFilterLabel = (categoryName: string): string =>
  `カテゴリ「${categoryName}」で絞り込む`;

export const QUALIFIER_WIN_HEADING = '予選勝利';

export const NO_OPPONENT_REASON = '対戦相手がいないため';

export const SETTLED_VOTES_PREFIX = '確定時点で';

// 票数は数と「票」だけを示すため、支援技術にだけ何の数かを伝える
export const UPVOTE_COUNT_PREFIX = 'Upvote数';
