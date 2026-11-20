import { Link, useRouter } from '@tanstack/react-router';
import { useEffect, useId, useRef } from 'react';

import { ADMIN_LAUNCH_STATE_LABELS } from '../../../../common-lib/moderation/moderation-labels.ts';
import { formatBusinessDateWithWeekdayLabel } from '../../../../common-lib/time/business-date-label.ts';
import {
  AdminDataTable,
  type AdminDataTableColumn,
  type AdminDataTablePagination,
} from '../../../../lib/components/admin/admin-data-table.tsx';
import { Badge } from '../../../../lib/components/ui/badge/badge.tsx';
import { cn } from '../../../../lib/utilities/class-names.ts';
import type { AdminModerationProductView } from '../../../graphql/admin-moderation-products.ts';
import { AdminMediaImage } from '../shared/admin-media-image.tsx';
import {
  latestLaunchLabel,
  NO_LAUNCH_LABEL,
  PRODUCT_LIST_CAPTION,
  PRODUCT_LIST_COLUMNS,
  PRODUCT_LIST_EMPTY_MESSAGE,
  PRODUCT_VISIBILITY_LABELS,
  productOwnerLabel,
  QUARANTINED_IMAGE_MARK,
  UNREADABLE_USER_LABEL,
} from '../shared/moderation-messages.ts';

export interface ProductTableProps {
  // undefinedは読み込み中
  readonly rows: readonly AdminModerationProductView[] | undefined;
  readonly error?: { readonly message: string; readonly onRetry: () => void };
  readonly pagination: AdminDataTablePagination;
  // 条件を変えて取り直す間。直前の一覧を操作できないまま残す
  readonly refetching: boolean;
}

const LOGO_DISPLAY = Object.freeze({ kind: 'square', size: 32 } as const);

// 隣の列に名称を示すため、ロゴは飾りとして名前を付けない
function LogoCell({
  product,
}: {
  readonly product: AdminModerationProductView;
}) {
  return (
    <div className="flex flex-col items-start gap-1">
      <AdminMediaImage
        file={product.logo}
        display={LOGO_DISPLAY}
        alt=""
        placeholder={{ label: product.name, seed: product.id }}
        className="rounded-md"
      />
      {product.logo?.quarantined === true ? (
        <Badge variant="outline">{QUARANTINED_IMAGE_MARK}</Badge>
      ) : null}
    </div>
  );
}

// ローンチ日は時刻を持たない業務日付のため、日時の表示部品に渡さず暦日のまま示す
function LatestLaunchCell({
  product,
}: {
  readonly product: AdminModerationProductView;
}) {
  const { latestLaunchDate, latestLaunchState } = product;
  if (latestLaunchDate === null) {
    return <span className="text-muted-foreground">{NO_LAUNCH_LABEL}</span>;
  }
  const dateLabel = formatBusinessDateWithWeekdayLabel(latestLaunchDate);
  const label =
    latestLaunchState === null
      ? dateLabel
      : latestLaunchLabel(
          dateLabel,
          ADMIN_LAUNCH_STATE_LABELS[latestLaunchState],
        );
  return (
    <span>
      <time dateTime={latestLaunchDate}>{dateLabel}</time>
      {label.slice(dateLabel.length)}
    </span>
  );
}

const COLUMNS: readonly AdminDataTableColumn<AdminModerationProductView>[] = [
  {
    key: 'logo',
    header: PRODUCT_LIST_COLUMNS.logo,
    cell: (product) => <LogoCell product={product} />,
  },
  {
    key: 'name',
    header: PRODUCT_LIST_COLUMNS.name,
    cell: (product) => (
      <Link
        to="/products/$productId"
        params={{ productId: product.id }}
        className="font-medium wrap-anywhere text-foreground underline underline-offset-4"
      >
        {product.name}
      </Link>
    ),
  },
  {
    key: 'handle',
    header: PRODUCT_LIST_COLUMNS.handle,
    cell: (product) => (
      <span translate="no" className="wrap-anywhere">
        {product.handle}
      </span>
    ),
  },
  {
    key: 'owner',
    header: PRODUCT_LIST_COLUMNS.owner,
    cell: (product) =>
      product.owner === null ? (
        <span className="text-muted-foreground">{UNREADABLE_USER_LABEL}</span>
      ) : (
        <span className="wrap-anywhere">
          {productOwnerLabel(product.owner.nickname, product.owner.handle)}
        </span>
      ),
  },
  {
    key: 'category',
    header: PRODUCT_LIST_COLUMNS.category,
    cell: (product) => product.category.name,
  },
  {
    key: 'latestLaunch',
    header: PRODUCT_LIST_COLUMNS.latestLaunch,
    cell: (product) => <LatestLaunchCell product={product} />,
    className: 'whitespace-nowrap',
  },
  {
    key: 'visibility',
    header: PRODUCT_LIST_COLUMNS.visibility,
    cell: (product) => PRODUCT_VISIBILITY_LABELS[product.visibility],
    className: 'whitespace-nowrap',
  },
];

const prefersReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function ProductTable({
  rows,
  error,
  pagination,
  refetching,
}: ProductTableProps) {
  const router = useRouter();
  const headingId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pendingRef = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      pendingRef.current?.();
    },
    [],
  );
  const moveToList = () => {
    headingRef.current?.focus({ preventScroll: true });
    sectionRef.current?.scrollIntoView({
      block: 'start',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  };
  // 移動の間は押したページ送りのボタンがinertになりフォーカスが<body>へ落ちるため、先にinertの外の一覧の見出しへ移す。ルーターは描画の後にスクロールを先頭へ戻すため、描画の後にもう一度一覧の先頭へ移る
  const beforePageMove = () => {
    moveToList();
    pendingRef.current?.();
    const unsubscribe = router.subscribe('onRendered', () => {
      unsubscribe();
      pendingRef.current = null;
      moveToList();
    });
    pendingRef.current = unsubscribe;
  };
  return (
    <section
      ref={sectionRef}
      aria-labelledby={headingId}
      className="flex scroll-mt-20 flex-col gap-4"
    >
      {/* 再試行で消える再試行のボタンからフォーカスを<body>へ落とさないよう、移り先としてプログラムからだけフォーカスできるようにする */}
      <h2
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className="rounded-sm text-lg font-semibold"
      >
        {PRODUCT_LIST_CAPTION}
      </h2>
      <div className="relative" aria-busy={refetching || undefined}>
        {refetching ? (
          <div
            aria-hidden="true"
            className="absolute inset-x-0 -top-2 h-1 rounded-full bg-primary/40"
          />
        ) : null}
        <div
          inert={refetching}
          className={cn(refetching && 'opacity-45 saturate-50')}
        >
          <AdminDataTable
            caption={PRODUCT_LIST_CAPTION}
            columns={COLUMNS}
            rows={rows}
            rowKey={(product) => product.id}
            {...(error === undefined
              ? {}
              : {
                  error: {
                    message: error.message,
                    onRetry: () => {
                      headingRef.current?.focus();
                      error.onRetry();
                    },
                  },
                })}
            emptyMessage={PRODUCT_LIST_EMPTY_MESSAGE}
            pagination={{
              ...pagination,
              onPrevious: () => {
                if (pagination.hasPrevious) {
                  beforePageMove();
                }
                pagination.onPrevious();
              },
              onNext: () => {
                if (pagination.hasNext) {
                  beforePageMove();
                }
                pagination.onNext();
              },
            }}
          />
        </div>
      </div>
    </section>
  );
}
