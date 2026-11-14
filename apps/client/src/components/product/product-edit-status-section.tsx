import { useId } from 'react';

import { INLINE_LINK_CLASS_NAME } from '../../../lib/components/navigation/inline-link-class.ts';
import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import type { MyProductEditView } from '../../graphql/my-products.ts';
import { CONTACT_HREF } from '../layout/site-links.ts';
import { LaunchPlanNotice } from './launch-plan-notice.tsx';
import { LaunchStatusText } from './launch-status-text.tsx';
import { MyProductSectionSlots } from './my-product-section-slots.tsx';
import {
  EDIT_STATUS_SECTION_HEADING,
  HIDDEN_PRODUCT_NOTICE,
} from './product-edit-messages.ts';
import type { MyProductSection } from './product-section-types.ts';

export interface ProductEditStatusSectionProps {
  readonly product: MyProductEditView;
  // orderの順に並べ替え済みの登録
  readonly sections: readonly MyProductSection[];
}

function HiddenProductNotice() {
  return (
    <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm leading-relaxed">
      {HIDDEN_PRODUCT_NOTICE.before}
      <PathLink href={CONTACT_HREF} className={INLINE_LINK_CLASS_NAME}>
        {HIDDEN_PRODUCT_NOTICE.link}
      </PathLink>
      {HIDDEN_PRODUCT_NOTICE.after}
    </p>
  );
}

// 編集画面の上部の状態の区画。直近のローンチの状態・次回の予約の可否と固定の理由・非公開化中の案内と、後続の機能が登録した区画を並べる
export function ProductEditStatusSection({
  product,
  sections,
}: ProductEditStatusSectionProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 text-card-foreground sm:p-5"
    >
      <h2 id={headingId} className="text-lg font-bold">
        {EDIT_STATUS_SECTION_HEADING}
      </h2>
      {product.hidden && <HiddenProductNotice />}
      <div className="grid gap-3 sm:grid-cols-2">
        {product.latestLaunch !== null && (
          <LaunchStatusText launch={product.latestLaunch} />
        )}
        <LaunchPlanNotice
          plan={product.plan}
          productHandle={product.handle}
          placement="edit"
        />
      </div>
      <MyProductSectionSlots
        sections={sections}
        product={{
          productHandle: product.handle,
          productName: product.name,
          hidden: product.hidden,
          placement: 'edit',
        }}
      />
    </section>
  );
}
