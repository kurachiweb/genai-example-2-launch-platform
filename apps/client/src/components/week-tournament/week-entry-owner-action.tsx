import type { ProductOwnerActionContext } from '../product-page/product-page-section-types.ts';
import { WeekEntryPanel } from './week-entry-panel.tsx';

// プロダクト詳細の投稿者本人向けの操作。秒読みはページの自動更新の切り替えに従い、秒読みを持つ間をページへ申告する
export function WeekEntryOwnerAction({
  product,
  autoRefresh,
  reportAutoUpdating,
}: ProductOwnerActionContext) {
  return (
    <WeekEntryPanel
      productHandle={product.handle}
      autoRefresh={autoRefresh}
      onAutoUpdatingChange={reportAutoUpdating}
    />
  );
}
