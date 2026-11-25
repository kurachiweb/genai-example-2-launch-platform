import type { MyProductSection } from '../components/product/product-section-types.ts';
import { WeekEntryMyProductSection } from '../components/week-tournament/week-entry-my-product-section.tsx';
import { YearEntryMyProductSection } from '../components/year-tournament/year-entry-my-product-section.tsx';

// 自分のプロダクトの一覧の各カードの下と編集画面の状態の区画に並べる区画の登録箇所。各specが自分の区画を追記する
export const MY_PRODUCT_SECTIONS: readonly MyProductSection[] = Object.freeze([
  {
    id: 'tournament-week.entry',
    order: 10,
    component: WeekEntryMyProductSection,
  },
  {
    id: 'tournament-year.entry',
    order: 20,
    component: YearEntryMyProductSection,
  },
]);
