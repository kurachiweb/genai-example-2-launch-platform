import type { ProductDeleteNotice } from '../components/product/product-section-types.ts';
import { ProductSponsorshipDeleteNotice } from '../components/sponsorship/product-sponsorship-delete-notice.tsx';
import { WeekEntryDeleteNotice } from '../components/week-tournament/week-entry-delete-notice.tsx';
import { YearEntryDeleteNotice } from '../components/year-tournament/year-entry-delete-notice.tsx';

// プロダクトの削除の確認ダイアログに並べる注意書きの登録箇所。各specが自分の注意書きを追記する
export const PRODUCT_DELETE_NOTICES: readonly ProductDeleteNotice[] =
  Object.freeze([
    {
      id: 'tournament-week.entry-loss',
      order: 10,
      component: WeekEntryDeleteNotice,
    },
    {
      id: 'tournament-year.entry-loss',
      order: 20,
      component: YearEntryDeleteNotice,
    },
    {
      id: 'sponsorship.active-ads',
      order: 30,
      component: ProductSponsorshipDeleteNotice,
    },
  ]);
