import { Link } from '@tanstack/react-router';
import { useLayoutEffect, useRef } from 'react';

import { AdminPageHeader } from '../../../lib/components/admin/admin-page-header.tsx';
import { EmptyState } from '../../../lib/components/state/empty-state.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import {
  PRODUCT_DETAIL_COPY,
  PRODUCT_NOT_FOUND_MESSAGE,
} from '../moderation/shared/moderation-messages.ts';

export interface ProductNotFoundPageProps {
  // 表示中の詳細が取り直しで消えて替わった時。押した操作ごと詳細が外れてフォーカスが<body>へ落ちるため、見つからない表示へ移す
  readonly replacedDetail?: boolean;
}

export function ProductNotFoundPage({
  replacedDetail = false,
}: ProductNotFoundPageProps) {
  const notFoundRef = useRef<HTMLDivElement>(null);
  // 描き替えの確定と同じ時点で移し、取り直しを待つ間に利用者がナビゲーションなどへ移したフォーカスは奪わない
  useLayoutEffect(() => {
    const active = document.activeElement;
    if (replacedDetail && (active === null || active === document.body)) {
      notFoundRef.current?.focus();
    }
  }, [replacedDetail]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <AdminPageHeader title={PRODUCT_DETAIL_COPY.pageTitle} />
      {/* 見出しで名前を持つ区画を、移り先としてプログラムからだけフォーカスできるようにする */}
      <EmptyState
        ref={notFoundRef}
        tabIndex={-1}
        headingLevel={2}
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
