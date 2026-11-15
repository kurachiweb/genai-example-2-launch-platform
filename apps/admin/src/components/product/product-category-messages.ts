import { checkHandleFormat } from '../../../common-lib/handles/handle-rules.ts';
import {
  PRODUCT_CATEGORY_HANDLE_MESSAGES,
  PRODUCT_CATEGORY_HANDLE_RULE,
} from '../../../common-lib/product/product-input-rules.ts';

export const PRODUCT_CATEGORIES_TITLE = 'プロダクトカテゴリ';

export const PRODUCT_CATEGORY_DELETE_DESCRIPTION =
  '削除したカテゴリは元に戻せません。プロダクトが紐付いているカテゴリは削除できません。削除から14日以内のプロダクトも紐付くものとして数えるため、14日を過ぎてから削除してください。';

// 妥当ならundefined、違反なら未入力・文字数超過・文字種違反の最初の1つの文言を返す
export const validateProductCategoryHandle = (
  handle: string,
): string | undefined =>
  PRODUCT_CATEGORY_HANDLE_MESSAGES[
    checkHandleFormat(handle, PRODUCT_CATEGORY_HANDLE_RULE)
  ];
