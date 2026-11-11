import { ProductDescription } from './product-description.tsx';
import type { ProductPageContext } from './product-page-section-types.ts';

export function ProductDescriptionSection({ page }: ProductPageContext) {
  return <ProductDescription markdown={page.description} />;
}
