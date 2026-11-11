import { HELP_CATEGORY_OTHER_NAME } from '../../../common-lib/help/help-category-constants.ts';

export const MOVE_UP_LABEL = '上へ移動';

export const MOVE_DOWN_LABEL = '下へ移動';

export const moveUpName = (name: string): string => `${name}を${MOVE_UP_LABEL}`;

export const moveDownName = (name: string): string =>
  `${name}を${MOVE_DOWN_LABEL}`;

export const helpItemMovedAnnouncement = (
  name: string,
  position: number,
): string => `${name}を${String(position)}番目に移動しました。`;

export const HELP_CATEGORIES_TITLE = 'ヘルプ記事カテゴリ';

const countFormat = new Intl.NumberFormat('ja-JP');

export const helpCategoryDeleteDescription = (articleCount: number): string =>
  `付け替わる記事は${countFormat.format(articleCount)}件です。付け替えた記事は「${HELP_CATEGORY_OTHER_NAME}」の末尾に並びます。`;

export const HELP_CATEGORY_ORDER_EDIT_LABEL = '並び順を変更';

export const HELP_CATEGORY_ORDER_LIST_LABEL = 'ヘルプ記事カテゴリの並び順';

export const HELP_CATEGORY_ORDER_CANCEL_LABEL = 'キャンセル';

export const HELP_ORDER_SAVE_LABEL = '保存';

export const HELP_ORDER_SAVED_MESSAGE = '並び順を保存しました。';

export const HELP_ORDER_OUTDATED_MESSAGE =
  '並び順が別の画面で変更されました。最新の並びを読み込んでから並べ替えてください。';

export const HELP_ORDER_RELOAD_LABEL = '最新の並びを読み込む';
