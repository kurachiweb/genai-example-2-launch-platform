import { useId } from 'react';

import { MediaPicture } from '../../../lib/components/media/media-picture.tsx';
import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { Badge } from '../../../lib/components/ui/badge/badge.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import type { MyProductCardView } from '../../graphql/my-products.ts';
import { myProductEditHref, productDetailHref } from '../layout/site-links.ts';
import { LaunchPlanNotice } from './launch-plan-notice.tsx';
import { LaunchStatusText } from './launch-status-text.tsx';
import {
  EDIT_PRODUCT_LABEL,
  editProductLabel,
  HIDDEN_PRODUCT_BADGE,
  productLogoAlt,
  VIEW_PRODUCT_LABEL,
  viewProductLabel,
} from './my-product-messages.ts';

export interface MyProductCardProps {
  readonly product: MyProductCardView;
  // 停止中の利用者は編集できないため、編集と予約の導線を無効にする
  readonly editable: boolean;
}

function EditAction({ product, editable }: MyProductCardProps) {
  const label = editProductLabel(product.name);
  // 移動させない導線はリンクとして描かず、押せないボタンにする
  if (!editable) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled
        aria-label={label}
      >
        {EDIT_PRODUCT_LABEL}
      </Button>
    );
  }
  return (
    <Button asChild size="sm" variant="outline">
      <PathLink href={myProductEditHref(product.handle)} aria-label={label}>
        {EDIT_PRODUCT_LABEL}
      </PathLink>
    </Button>
  );
}

export function MyProductCard({ product, editable }: MyProductCardProps) {
  const nameId = useId();
  return (
    <article
      aria-labelledby={nameId}
      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 text-card-foreground sm:flex-row sm:items-start sm:p-5"
    >
      <MediaPicture
        image={product.logo}
        display={{ kind: 'square', size: 64 }}
        alt={productLogoAlt(product.name)}
        placeholder={{ label: product.name, seed: product.handle }}
        loading="lazy"
        className="size-16 rounded-lg"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={nameId} className="text-lg font-bold wrap-anywhere">
            {product.name}
          </h2>
          <p className="text-sm wrap-anywhere text-muted-foreground">
            {product.handle}
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{product.category.name}</Badge>
            {product.hidden && (
              <Badge variant="outline">{HIDDEN_PRODUCT_BADGE}</Badge>
            )}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {product.latestLaunch !== null && (
            <LaunchStatusText launch={product.latestLaunch} />
          )}
          <LaunchPlanNotice
            plan={product.plan}
            productHandle={product.handle}
            placement="list"
            editable={editable}
          />
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col">
        <EditAction product={product} editable={editable} />
        {!product.hidden && (
          <Button asChild size="sm" variant="ghost">
            <PathLink
              href={productDetailHref(product.handle)}
              aria-label={viewProductLabel(product.name)}
            >
              {VIEW_PRODUCT_LABEL}
            </PathLink>
          </Button>
        )}
      </div>
    </article>
  );
}
