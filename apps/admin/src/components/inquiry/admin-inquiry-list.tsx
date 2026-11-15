import { Link } from '@tanstack/react-router';
import { useId, useRef } from 'react';

import {
  AdminDataTable,
  type AdminDataTableColumn,
  type AdminDataTablePagination,
} from '../../../lib/components/admin/admin-data-table.tsx';
import { DateTime } from '../../../lib/components/datetime/date-time.tsx';
import { InquiryStatusBadge } from '../../../lib/components/inquiry/inquiry-status-badge.tsx';
import { Badge } from '../../../lib/components/ui/badge/badge.tsx';
import type { AdminInquiryListEntry } from '../../graphql/admin-inquiries.ts';
import {
  INQUIRY_KIND_LABELS,
  INQUIRY_LIST_CAPTION,
  INQUIRY_LIST_COLUMNS,
  INQUIRY_LIST_EMPTY_MESSAGE,
  WITHDRAWN_LABEL,
} from './admin-inquiries-messages.ts';

export interface AdminInquiryListProps {
  // undefinedは読み込み中
  readonly entries: readonly AdminInquiryListEntry[] | undefined;
  readonly error?: { readonly message: string; readonly onRetry: () => void };
  readonly pagination: AdminDataTablePagination;
}

const COLUMNS: readonly AdminDataTableColumn<AdminInquiryListEntry>[] = [
  {
    key: 'createdAt',
    header: INQUIRY_LIST_COLUMNS.createdAt,
    cell: (entry) => <DateTime value={entry.createdAt} format="longDateTime" />,
    className: 'whitespace-nowrap',
  },
  {
    key: 'kind',
    header: INQUIRY_LIST_COLUMNS.kind,
    cell: (entry) => INQUIRY_KIND_LABELS[entry.kind],
    className: 'whitespace-nowrap',
  },
  {
    key: 'category',
    header: INQUIRY_LIST_COLUMNS.category,
    cell: (entry) => (
      <span className="wrap-anywhere">{entry.categoryName}</span>
    ),
  },
  {
    key: 'status',
    header: INQUIRY_LIST_COLUMNS.status,
    cell: (entry) => <InquiryStatusBadge status={entry.status} />,
  },
  {
    key: 'sender',
    header: INQUIRY_LIST_COLUMNS.sender,
    cell: (entry) => (
      <span className="flex flex-wrap items-center gap-2">
        <Link
          to="/inquiries/$inquiryId"
          params={{ inquiryId: entry.id }}
          className="font-medium wrap-anywhere text-foreground underline underline-offset-4"
        >
          {entry.senderName}
        </Link>
        {entry.withdrawn ? (
          <Badge variant="outline">{WITHDRAWN_LABEL}</Badge>
        ) : null}
      </span>
    ),
  },
  {
    key: 'lastMessageAt',
    header: INQUIRY_LIST_COLUMNS.lastMessageAt,
    cell: (entry) => (
      <DateTime value={entry.lastMessageAt} format="longDateTime" />
    ),
    className: 'whitespace-nowrap',
  },
];

export function AdminInquiryList({
  entries,
  error,
  pagination,
}: AdminInquiryListProps) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      {/* 再試行で消える再試行のボタンからフォーカスを<body>へ落とさないよう、移り先としてプログラムからだけフォーカスできるようにする */}
      <h2
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className="rounded-sm text-lg font-semibold"
      >
        {INQUIRY_LIST_CAPTION}
      </h2>
      <AdminDataTable
        caption={INQUIRY_LIST_CAPTION}
        columns={COLUMNS}
        rows={entries}
        rowKey={(entry) => entry.id}
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
        emptyMessage={INQUIRY_LIST_EMPTY_MESSAGE}
        pagination={pagination}
      />
    </section>
  );
}
