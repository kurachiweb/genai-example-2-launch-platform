import type { MyProductSectionContext } from '../product/product-section-types.ts';
import { YearEntryPanel } from './year-entry-panel.tsx';

// 自分のプロダクトの一覧のカードの下と編集画面の状態の区画に、プロダクト詳細と同じ参加費の導線を描く
export function YearEntryMyProductSection({
  product,
}: {
  readonly product: MyProductSectionContext;
}) {
  return <YearEntryPanel productHandle={product.productHandle} />;
}
