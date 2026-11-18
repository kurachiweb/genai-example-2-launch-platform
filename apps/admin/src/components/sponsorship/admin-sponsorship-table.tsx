import { useId, useRef } from 'react';

import { SPONSORSHIP_TIER_LABELS } from '../../../common-lib/sponsorship/sponsorship-tiers.ts';
import { formatBusinessDateWithWeekdayLabel } from '../../../common-lib/time/business-date-label.ts';
import {
  AdminDataTable,
  type AdminDataTableColumn,
  type AdminDataTablePagination,
} from '../../../lib/components/admin/admin-data-table.tsx';
import { DateTime } from '../../../lib/components/datetime/date-time.tsx';
import { MoneyText } from '../../../lib/components/payments/money-text.tsx';
import { SponsorshipStatusBadge } from '../../../lib/components/sponsorship/sponsorship-status-badge.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import {
  type AdminSponsorshipRow,
  toSponsorshipStatus,
  toSponsorshipTier,
} from '../../graphql/admin-sponsorships.ts';
import { RoleGate } from '../layout/role-gate.tsx';
import {
  DELETED_PRODUCT_LABEL,
  SPONSORSHIP_LIST_CAPTION,
  SPONSORSHIP_LIST_COLUMNS,
  SPONSORSHIP_LIST_EMPTY_MESSAGE,
  SPONSORSHIP_PERIOD_SEPARATOR,
  sponsorshipDaysLabel,
  TERMINATE_LABEL,
  terminateButtonName,
  UNPAID_AMOUNT_TEXT,
  UNREADABLE_APPLICANT_LABEL,
} from './admin-sponsorships-messages.ts';

export interface AdminSponsorshipTableProps {
  // undefinedは読み込み中
  readonly rows: readonly AdminSponsorshipRow[] | undefined;
  readonly error?: { readonly message: string; readonly onRetry: () => void };
  readonly pagination: AdminDataTablePagination;
  // 強制終了の確認を開く。モデレーター以上の管理者に、強制終了できる行のボタンで呼ぶ
  readonly onTerminate?: (sponsorship: AdminSponsorshipRow) => void;
}

function ProductCell({ row }: { readonly row: AdminSponsorshipRow }) {
  if (row.productDeleted || row.productName === null) {
    return (
      <span className="text-muted-foreground">{DELETED_PRODUCT_LABEL}</span>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-medium wrap-anywhere">{row.productName}</span>
      {row.productHandle === null ? null : (
        <span className="text-xs wrap-anywhere text-muted-foreground">
          {row.productHandle}
        </span>
      )}
    </div>
  );
}

// 掲載期間は時刻を持たない業務日付のため、日時の表示部品に渡さず暦日のまま示す
function PeriodCell({ row }: { readonly row: AdminSponsorshipRow }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span>
        <time dateTime={row.startsOn}>
          {formatBusinessDateWithWeekdayLabel(row.startsOn)}
        </time>
        {SPONSORSHIP_PERIOD_SEPARATOR}
        <time dateTime={row.endsOn}>
          {formatBusinessDateWithWeekdayLabel(row.endsOn)}
        </time>
      </span>
      <span className="text-xs text-muted-foreground">
        {sponsorshipDaysLabel(row.days)}
      </span>
    </div>
  );
}

const columnsOf = (
  onTerminate: ((sponsorship: AdminSponsorshipRow) => void) | undefined,
): readonly AdminDataTableColumn<AdminSponsorshipRow>[] => [
  {
    key: 'id',
    header: SPONSORSHIP_LIST_COLUMNS.id,
    cell: (row) => (
      <span className="font-mono text-xs break-all">{row.id}</span>
    ),
  },
  {
    key: 'product',
    header: SPONSORSHIP_LIST_COLUMNS.product,
    cell: (row) => <ProductCell row={row} />,
  },
  {
    key: 'applicant',
    header: SPONSORSHIP_LIST_COLUMNS.applicant,
    cell: (row) =>
      row.applicantNickname === null ? (
        <span className="text-muted-foreground">
          {UNREADABLE_APPLICANT_LABEL}
        </span>
      ) : (
        <span className="wrap-anywhere">{row.applicantNickname}</span>
      ),
  },
  {
    key: 'tier',
    header: SPONSORSHIP_LIST_COLUMNS.tier,
    cell: (row) => (
      <span translate="no">
        {SPONSORSHIP_TIER_LABELS[toSponsorshipTier(row.tier)]}
      </span>
    ),
  },
  {
    key: 'period',
    header: SPONSORSHIP_LIST_COLUMNS.period,
    cell: (row) => <PeriodCell row={row} />,
    className: 'whitespace-nowrap',
  },
  {
    key: 'amountPaid',
    header: SPONSORSHIP_LIST_COLUMNS.amountPaid,
    cell: (row) =>
      row.amountPaid === null ? (
        UNPAID_AMOUNT_TEXT
      ) : (
        <MoneyText amount={row.amountPaid.amount} />
      ),
    className: 'whitespace-nowrap tabular-nums',
  },
  {
    key: 'status',
    header: SPONSORSHIP_LIST_COLUMNS.status,
    cell: (row) => (
      <SponsorshipStatusBadge status={toSponsorshipStatus(row.status)} />
    ),
  },
  {
    key: 'createdAt',
    header: SPONSORSHIP_LIST_COLUMNS.createdAt,
    cell: (row) => <DateTime value={row.createdAt} format="longDateTime" />,
    className: 'whitespace-nowrap',
  },
  {
    key: 'actions',
    header: SPONSORSHIP_LIST_COLUMNS.actions,
    cell: (row) =>
      row.terminable ? (
        <RoleGate minimum="moderator">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={terminateButtonName(row.id)}
            onClick={() => {
              onTerminate?.(row);
            }}
          >
            {TERMINATE_LABEL}
          </Button>
        </RoleGate>
      ) : null,
  },
];

export function AdminSponsorshipTable({
  rows,
  error,
  pagination,
  onTerminate,
}: AdminSponsorshipTableProps) {
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
        {SPONSORSHIP_LIST_CAPTION}
      </h2>
      <AdminDataTable
        caption={SPONSORSHIP_LIST_CAPTION}
        columns={columnsOf(onTerminate)}
        rows={rows}
        rowKey={(row) => row.id}
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
        emptyMessage={SPONSORSHIP_LIST_EMPTY_MESSAGE}
        pagination={pagination}
      />
    </section>
  );
}
