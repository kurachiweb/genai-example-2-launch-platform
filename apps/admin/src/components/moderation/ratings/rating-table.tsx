import { useId, useRef } from 'react';

import {
  AdminDataTable,
  type AdminDataTableColumn,
  type AdminDataTablePagination,
} from '../../../../lib/components/admin/admin-data-table.tsx';
import { DateTime } from '../../../../lib/components/datetime/date-time.tsx';
import { cn } from '../../../../lib/utilities/class-names.ts';
import type { AdminModerationRatingView } from '../../../graphql/admin-moderation-engagement.ts';
import { ModerationDialogHost } from '../shared/moderation-dialog-host.tsx';
import {
  NO_VALUE_LABEL,
  productOwnerLabel,
  RATING_LIST_CAPTION,
  RATING_LIST_COLUMNS,
  RATING_LIST_EMPTY_MESSAGE,
  RATING_STATE_LABELS,
  ratingScoreLabel,
  UNREADABLE_USER_LABEL,
} from '../shared/moderation-messages.ts';
import { RatingModerationActions } from './rating-moderation-actions.tsx';

export interface RatingTableProps {
  // undefinedは読み込み中
  readonly rows: readonly AdminModerationRatingView[] | undefined;
  readonly error?: { readonly message: string; readonly onRetry: () => void };
  readonly pagination: AdminDataTablePagination;
  // 条件を変えて取り直す間。直前の一覧を操作できないまま残す
  readonly refetching: boolean;
}

const prefersReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const COLUMNS: readonly AdminDataTableColumn<AdminModerationRatingView>[] = [
  {
    key: 'rater',
    header: RATING_LIST_COLUMNS.rater,
    className: 'wrap-anywhere whitespace-normal',
    cell: ({ rater }) =>
      rater === null
        ? UNREADABLE_USER_LABEL
        : productOwnerLabel(rater.nickname, rater.handle),
  },
  {
    key: 'product',
    header: RATING_LIST_COLUMNS.product,
    className: 'wrap-anywhere whitespace-normal',
    cell: ({ productName }) => productName ?? NO_VALUE_LABEL,
  },
  {
    key: 'score',
    header: RATING_LIST_COLUMNS.score,
    // 見えている数だけでは段階の数が伝わらないため、支援技術には5段階中の点数として伝える
    cell: ({ score }) => (
      <>
        <span aria-hidden="true">{score}</span>
        <span className="sr-only">{ratingScoreLabel(score)}</span>
      </>
    ),
  },
  {
    key: 'updatedAt',
    header: RATING_LIST_COLUMNS.updatedAt,
    className: 'whitespace-nowrap',
    cell: ({ updatedAt }) => (
      <DateTime value={updatedAt} format="longDateTime" />
    ),
  },
  {
    key: 'state',
    header: RATING_LIST_COLUMNS.state,
    className: 'whitespace-nowrap',
    cell: ({ state }) => RATING_STATE_LABELS[state],
  },
  {
    key: 'actions',
    header: RATING_LIST_COLUMNS.actions,
    cell: (rating) => <RatingModerationActions rating={rating} />,
  },
];

export function RatingTable({
  rows,
  error,
  pagination,
  refetching,
}: RatingTableProps) {
  const headingId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // 移動の間は押したページ送りのボタンがinertになりフォーカスが<body>へ落ちるため、先にinertの外の一覧の見出しへ移し、新しいページを一覧の先頭から読めるようにする
  const moveToList = () => {
    headingRef.current?.focus({ preventScroll: true });
    sectionRef.current?.scrollIntoView({
      block: 'start',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  };
  return (
    <section
      ref={sectionRef}
      aria-labelledby={headingId}
      className="flex scroll-mt-20 flex-col gap-4"
    >
      {/* 再試行や措置の後に消える操作からフォーカスを<body>へ落とさないよう、移り先としてプログラムからだけフォーカスできるようにする */}
      <h2
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className="rounded-sm text-lg font-semibold"
      >
        {RATING_LIST_CAPTION}
      </h2>
      <ModerationDialogHost fallbackFocusRef={headingRef}>
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
              caption={RATING_LIST_CAPTION}
              columns={COLUMNS}
              rows={rows}
              rowKey={(rating) => rating.id}
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
              emptyMessage={RATING_LIST_EMPTY_MESSAGE}
              pagination={{
                ...pagination,
                onPrevious: () => {
                  if (pagination.hasPrevious) {
                    moveToList();
                  }
                  pagination.onPrevious();
                },
                onNext: () => {
                  if (pagination.hasNext) {
                    moveToList();
                  }
                  pagination.onNext();
                },
              }}
            />
          </div>
        </div>
      </ModerationDialogHost>
    </section>
  );
}
