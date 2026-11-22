import { useRouter } from '@tanstack/react-router';
import { useEffect, useId, useRef } from 'react';

import {
  AdminDataTable,
  type AdminDataTableColumn,
  type AdminDataTablePagination,
} from '../../../../lib/components/admin/admin-data-table.tsx';
import { DateTime } from '../../../../lib/components/datetime/date-time.tsx';
import { cn } from '../../../../lib/utilities/class-names.ts';
import type { ReportCaseView } from '../../../graphql/admin-reporting-cases.ts';
import { CategoryBreakdown } from '../shared/category-breakdown.tsx';
import { ReportCaseActions } from '../shared/report-case-actions.tsx';
import { ReportCaseDialogHost } from '../shared/report-case-dialog-host.tsx';
import { ReportCaseStatusBadge } from '../shared/report-case-status-badge.tsx';
import { reportCountLabel } from '../shared/report-messages.ts';
import { ReportTargetCell } from '../shared/report-target-cell.tsx';
import { ResponseTimeCell } from '../shared/response-time-cell.tsx';
import {
  REPORT_LIST_CAPTION,
  REPORT_LIST_COLUMNS,
  REPORT_LIST_EMPTY_MESSAGE,
} from './report-list-messages.ts';

export interface ReportCaseTableProps {
  // undefinedは読み込み中
  readonly rows: readonly ReportCaseView[] | undefined;
  readonly error?: { readonly message: string; readonly onRetry: () => void };
  readonly pagination: AdminDataTablePagination;
  // 条件を変えて取り直す間。直前の一覧を操作できないまま残す
  readonly refetching: boolean;
}

const COLUMNS: readonly AdminDataTableColumn<ReportCaseView>[] = [
  {
    key: 'target',
    header: REPORT_LIST_COLUMNS.target,
    className: 'min-w-48 whitespace-normal',
    cell: (reportCase) => (
      <ReportTargetCell
        target={reportCase.target}
        detailCaseId={reportCase.id}
      />
    ),
  },
  {
    key: 'reportCount',
    header: REPORT_LIST_COLUMNS.reportCount,
    className: 'whitespace-nowrap',
    cell: ({ reportCount }) => reportCountLabel(reportCount),
  },
  {
    key: 'categoryCounts',
    header: REPORT_LIST_COLUMNS.categoryCounts,
    className: 'whitespace-nowrap',
    cell: ({ categoryCounts }) => <CategoryBreakdown counts={categoryCounts} />,
  },
  {
    key: 'status',
    header: REPORT_LIST_COLUMNS.status,
    className: 'whitespace-nowrap',
    cell: ({ status }) => <ReportCaseStatusBadge status={status} />,
  },
  {
    key: 'firstReportedAt',
    header: REPORT_LIST_COLUMNS.firstReportedAt,
    className: 'whitespace-nowrap',
    cell: ({ firstReportedAt }) => (
      <DateTime value={firstReportedAt} format="longDateTime" />
    ),
  },
  {
    key: 'lastReportedAt',
    header: REPORT_LIST_COLUMNS.lastReportedAt,
    className: 'whitespace-nowrap',
    cell: ({ lastReportedAt }) => (
      <DateTime value={lastReportedAt} format="longDateTime" />
    ),
  },
  {
    key: 'responseTime',
    header: REPORT_LIST_COLUMNS.responseTime,
    className: 'min-w-40 whitespace-normal',
    cell: ({ responseTime }) => (
      <ResponseTimeCell responseTime={responseTime} />
    ),
  },
  {
    key: 'actions',
    header: REPORT_LIST_COLUMNS.actions,
    cell: (reportCase) => <ReportCaseActions reportCase={reportCase} />,
  },
];

const prefersReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function ReportCaseTable({
  rows,
  error,
  pagination,
  refetching,
}: ReportCaseTableProps) {
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
  // 移動の間は押したページ送りのボタンがinertになりフォーカスが<body>へ落ちるため、先にinertの外の一覧の見出しへ移す。描画の後にもう一度一覧の先頭へ移り、新しいページを一覧の先頭から読めるようにする
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
      {/* 再試行や確定の後に消える操作からフォーカスを<body>へ落とさないよう、移り先としてプログラムからだけフォーカスできるようにする */}
      <h2
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className="rounded-sm text-lg font-semibold"
      >
        {REPORT_LIST_CAPTION}
      </h2>
      <ReportCaseDialogHost fallbackFocusRef={headingRef}>
        <div className="relative" aria-busy={refetching || undefined}>
          {refetching ? (
            <div
              aria-hidden="true"
              className="absolute inset-x-0 -top-2 h-1 rounded-full bg-primary/40 motion-safe:animate-pulse"
            />
          ) : null}
          <div
            inert={refetching}
            className={cn(refetching && 'opacity-45 saturate-50')}
          >
            <AdminDataTable
              caption={REPORT_LIST_CAPTION}
              columns={COLUMNS}
              rows={rows}
              rowKey={(reportCase) => reportCase.id}
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
              emptyMessage={REPORT_LIST_EMPTY_MESSAGE}
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
      </ReportCaseDialogHost>
    </section>
  );
}
