import { BanIcon } from 'lucide-react';
import { useId, useRef } from 'react';

import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import type { ClientViewer } from '../../graphql/viewer.ts';
import { CONTACT_HREF, NEW_PRODUCT_HREF } from '../layout/site-links.ts';
import { SUSPENDED_NOTICE_LABEL } from '../settings/settings-messages.ts';
import {
  MY_PRODUCTS_PAGE_DESCRIPTION,
  MY_PRODUCTS_PAGE_TITLE,
  MY_PRODUCTS_SUSPENDED_CONTACT_LABEL,
  MY_PRODUCTS_SUSPENDED_NOTICE,
  NEW_PRODUCT_LABEL,
} from './my-product-messages.ts';
import { MyProductList } from './my-product-list.tsx';
import { orderProductSections } from './product-section-order.ts';
import type { MyProductSection } from './product-section-types.ts';

export interface MyProductListPageProps {
  readonly viewer: ClientViewer;
  readonly sections: readonly MyProductSection[];
}

// 移動させない導線はリンクとして描かず、押せないボタンにする
function NewProductAction({ editable }: { readonly editable: boolean }) {
  if (!editable) {
    return (
      <Button type="button" disabled>
        {NEW_PRODUCT_LABEL}
      </Button>
    );
  }
  return (
    <Button asChild>
      <PathLink href={NEW_PRODUCT_HREF}>{NEW_PRODUCT_LABEL}</PathLink>
    </Button>
  );
}

function SuspendedNotice() {
  return (
    <div
      role="note"
      aria-label={SUSPENDED_NOTICE_LABEL}
      className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-destructive/40 bg-destructive/5 px-4 py-3.5 sm:px-5"
    >
      <BanIcon
        aria-hidden="true"
        className="size-6 shrink-0 text-destructive"
      />
      <p className="min-w-0 flex-1 text-sm leading-relaxed">
        {MY_PRODUCTS_SUSPENDED_NOTICE}
      </p>
      <Button size="sm" variant="outline" className="bg-card" asChild>
        <PathLink href={CONTACT_HREF}>
          {MY_PRODUCTS_SUSPENDED_CONTACT_LABEL}
        </PathLink>
      </Button>
    </div>
  );
}

export function MyProductListPage({
  viewer,
  sections,
}: MyProductListPageProps) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const editable = viewer.status !== 'SUSPENDED';
  const newProductAction = <NewProductAction editable={editable} />;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:py-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          {/* 再試行で消える再試行のボタンからフォーカスを<body>へ落とさないよう、移り先としてプログラムからだけフォーカスできるようにする */}
          <h1
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className="rounded-sm text-2xl font-extrabold tracking-tight sm:text-3xl"
          >
            {MY_PRODUCTS_PAGE_TITLE}
          </h1>
          <p className="text-sm text-muted-foreground">
            {MY_PRODUCTS_PAGE_DESCRIPTION}
          </p>
        </div>
        <div className="shrink-0">{newProductAction}</div>
      </div>
      {!editable && <SuspendedNotice />}
      <MyProductList
        viewerId={viewer.id}
        sections={orderProductSections(sections)}
        editable={editable}
        labelledBy={headingId}
        retryFocusRef={headingRef}
        newProductAction={newProductAction}
      />
    </div>
  );
}
