import type { MyProductSectionContext } from '../product/product-section-types.ts';
import { WeekEntryPanel } from './week-entry-panel.tsx';

// 自分のプロダクトの一覧と編集画面には自動更新の切り替えが無いため、毎秒の秒読みを出さず、受付期限の日時と注意色だけで示す
export function WeekEntryMyProductSection({
  product,
}: {
  readonly product: MyProductSectionContext;
}) {
  return (
    <WeekEntryPanel productHandle={product.productHandle} autoRefresh={false} />
  );
}
