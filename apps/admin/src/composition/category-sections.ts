import type { ComponentType } from 'react';

import { HELP_CATEGORIES_TITLE } from '../components/help/help-messages.ts';
import { HelpCategorySection } from '../components/help/help-category-section.tsx';
import { InquiryCategorySection } from '../components/inquiry/inquiry-category-section.tsx';
import { INQUIRY_CATEGORIES_TITLE } from '../components/inquiry/inquiry-category-messages.ts';
import { PRODUCT_CATEGORIES_TITLE } from '../components/product/product-category-messages.ts';
import { ProductCategorySection } from '../components/product/product-category-section.tsx';

export interface CategorySection {
  // '<spec名>.<名詞句>'
  readonly id: string;
  // product-launchのプロダクトカテゴリ10・help-centerのヘルプ記事カテゴリ20・inquiry-chatの問い合わせカテゴリ30・content-reportingの通報カテゴリ40
  readonly order: number;
  // 区画の見出し。部品が描くCategoryMasterEditorのtitleと同じ文言にする
  readonly title: string;
  // 自分でデータを取得し、CategoryMasterEditorで表示する
  readonly component: ComponentType;
}

// カテゴリのページに並べる区画の登録箇所。各specが自分のカテゴリマスタの区画を追記する
export const CATEGORY_SECTIONS: readonly CategorySection[] = Object.freeze([
  {
    id: 'product-launch.product-categories',
    order: 10,
    title: PRODUCT_CATEGORIES_TITLE,
    component: ProductCategorySection,
  },
  {
    id: 'help-center.help-categories',
    order: 20,
    title: HELP_CATEGORIES_TITLE,
    component: HelpCategorySection,
  },
  {
    id: 'inquiry-chat.inquiry-categories',
    order: 30,
    title: INQUIRY_CATEGORIES_TITLE,
    component: InquiryCategorySection,
  },
]);
