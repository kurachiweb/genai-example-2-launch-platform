import type { ProductPageContext } from './product-page-section-types.ts';
import { ScreenshotGallery } from './screenshot-gallery.tsx';

export function ScreenshotGallerySection({ page }: ProductPageContext) {
  return (
    <ScreenshotGallery productName={page.name} screenshots={page.screenshots} />
  );
}
