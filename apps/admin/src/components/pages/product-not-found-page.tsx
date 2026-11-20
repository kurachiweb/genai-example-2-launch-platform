import { Link } from '@tanstack/react-router';

import { AdminPageHeader } from '../../../lib/components/admin/admin-page-header.tsx';
import { EmptyState } from '../../../lib/components/state/empty-state.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import {
  PRODUCT_DETAIL_COPY,
  PRODUCT_NOT_FOUND_MESSAGE,
} from '../moderation/shared/moderation-messages.ts';

export function ProductNotFoundPage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <AdminPageHeader title={PRODUCT_DETAIL_COPY.pageTitle} />
      <EmptyState
        title={PRODUCT_NOT_FOUND_MESSAGE}
        action={
          <Button asChild variant="outline">
            <Link to="/products">{PRODUCT_DETAIL_COPY.backToList}</Link>
          </Button>
        }
      />
    </div>
  );
}
