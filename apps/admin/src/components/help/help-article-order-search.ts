import { z } from '../../../lib/utilities/validation/zod.ts';
import { HELP_ID_SEARCH_FIELD } from './help-article-filter.ts';

// 並べ替えるカテゴリのID。未指定は並び順の先頭のカテゴリ
export interface HelpArticleOrderSearch {
  readonly category?: string | undefined;
}

const ORDER_SEARCH_SCHEMA = z.object({ category: HELP_ID_SEARCH_FIELD });

// ルーターは検証の結果をURLの元の値に重ねるため、元の値を残さないよう常に全ての項目を返す。共有されたURLや手で書き換えたURLの不正な値は未指定として扱う
export const parseHelpArticleOrderSearch = (
  search: Readonly<Record<string, unknown>>,
): HelpArticleOrderSearch => {
  const { category } = ORDER_SEARCH_SCHEMA.parse(search);
  return { category };
};

// 削除されたカテゴリを指すURLでも並べ替えを続けられるよう、見つからない指定は未指定と同じく先頭のカテゴリにする
export const selectHelpOrderCategory = <T extends { readonly id: string }>(
  categories: readonly T[],
  requested: string | undefined,
): T | undefined =>
  categories.find(({ id }) => id === requested) ?? categories[0];
