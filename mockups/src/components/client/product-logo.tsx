import { InitialPlaceholder } from '#/components/client/art/initial-placeholder';
import { ProductLogoArt } from '#/components/client/art/product-logo-art';
import type { Product } from '#/lib/mock-data';

type Props = {
  product: Pick<Product, 'id' | 'name' | 'art'>;
  size: number;
  // 読み込み失敗または隔離中(FR-FILEU-011・FR-ADMUG-025〜027)
  broken?: boolean;
  className?: string;
};

export function ProductLogo({ product, size, broken, className }: Props) {
  if (broken) {
    return (
      <InitialPlaceholder
        seed={product.id}
        name={product.name}
        size={size}
        shape="rounded"
        label={`${product.name}のロゴ`}
        className={className}
      />
    );
  }
  return (
    <ProductLogoArt
      palette={product.art.palette}
      variant={product.art.variant}
      size={size}
      title={product.name}
      className={className}
    />
  );
}
