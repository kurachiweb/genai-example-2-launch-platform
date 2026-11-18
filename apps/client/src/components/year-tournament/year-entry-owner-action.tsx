import type { ProductOwnerActionContext } from '../product-page/product-page-section-types.ts';
import { YearEntryPanel } from './year-entry-panel.tsx';

// プロダクト詳細の投稿者本人向けの操作。秒読みを持たないため、ページの自動更新の切り替えを受けず自動更新中も申告しない
export function YearEntryOwnerAction({ product }: ProductOwnerActionContext) {
  return <YearEntryPanel productHandle={product.handle} />;
}
