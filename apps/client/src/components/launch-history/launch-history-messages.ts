import type { ProductAwardKindView } from '../../graphql/product-launch.ts';

export const LAUNCH_HISTORY_TAB_LABEL = 'ローンチ履歴';

export const LAUNCH_HISTORY_LOAD_ERROR =
  'ローンチしたプロダクトを読み込めませんでした。時間をおいて再度お試しください。';

export const LAUNCH_HISTORY_LOAD_MORE_ERROR = '続きを読み込めませんでした。';

export const LAUNCH_HISTORY_LOAD_MORE_LABEL = 'さらに読み込む';

export const LAUNCH_HISTORY_LOAD_MORE_PENDING_LABEL = '読み込み中';

export const LAUNCH_HISTORY_EMPTY_TITLE =
  'まだローンチしたプロダクトはありません。';

export const LAUNCH_HISTORY_EMPTY_OWNER_DESCRIPTION =
  'ローンチ日には予選マッチで1対1の対戦が始まります。勝利するとディレクトリに掲載されます。';

export const UNLISTED_PRODUCTS_NOTICE =
  '未掲載のプロダクトはあなたにだけ表示されています。予選で勝利するとディレクトリに掲載され、誰でも見られるようになります。';

export const UNLISTED_PRODUCT_BADGE = '未掲載・あなたにだけ表示';

export const PRIVATE_PRODUCT_BADGE = '非公開';

export const OPEN_SITE_LABEL = 'サイトを開く';

// 項目ごとに同じ文言のリンクが並ぶため、読み上げではプロダクト名を前に付けて区別する
export const openSiteLabelPrefix = (name: string): string => `${name}の`;

export const launchNumberLabel = (number: number): string =>
  `第${number.toString()}回`;

export const showMoreLaunchesLabel = (count: number): string =>
  `他${count.toString()}回を表示`;

export const AWARD_NAMES: Readonly<Record<ProductAwardKindView, string>> =
  Object.freeze({
    year: 'Product of the Year',
    week: 'Product of the Week',
  });

// 2回以上は名前に続けて回数を示す
export const awardBadgeLabel = (
  kind: ProductAwardKindView,
  count: number,
): string =>
  count >= 2 ? `${AWARD_NAMES[kind]} ×${count.toString()}` : AWARD_NAMES[kind];

// 読み上げ用の文言は、ツールチップの1件1行の行を「、」でつなぐ
export const awardDescriptionOf = (labels: readonly string[]): string =>
  labels.join('、');
