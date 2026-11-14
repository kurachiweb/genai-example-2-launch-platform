import { INQUIRY_CATEGORY_OTHER_NAME } from '../../../common-lib/inquiry/inquiry-category-constants.ts';

export const INQUIRY_CATEGORIES_TITLE = '問い合わせカテゴリ';

const countFormat = new Intl.NumberFormat('ja-JP');

export const inquiryCategoryDeleteDescription = (linkedCount: number): string =>
  `紐付く${countFormat.format(linkedCount)}件の問い合わせは標準カテゴリ「${INQUIRY_CATEGORY_OTHER_NAME}」へ付け替えられます。`;
