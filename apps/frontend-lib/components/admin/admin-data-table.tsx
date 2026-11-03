import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import {
  ADMIN_PAGINATION_LABEL,
  NEXT_PAGE_LABEL,
  PREVIOUS_PAGE_LABEL,
} from '../../utilities/messages/admin-console-messages.ts';
import { EmptyState } from '../state/empty-state.tsx';
import { ErrorState } from '../state/error-state.tsx';
import { LoadingSkeleton } from '../state/loading-skeleton.tsx';
import { Button } from '../ui/button/button.tsx';
import { Skeleton } from '../ui/skeleton/skeleton.tsx';
import { Table } from '../ui/table/table.tsx';
import { TableBody } from '../ui/table/table-body.tsx';
import { TableCaption } from '../ui/table/table-caption.tsx';
import { TableCell } from '../ui/table/table-cell.tsx';
import { TableHead } from '../ui/table/table-head.tsx';
import { TableHeader } from '../ui/table/table-header.tsx';
import { TableRow } from '../ui/table/table-row.tsx';

export interface AdminDataTableColumn<Row> {
  readonly key: string;
  readonly header: string;
  readonly cell: (row: Row) => ReactNode;
  readonly className?: string;
}

export interface AdminDataTablePagination {
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
}

export interface AdminDataTableProps<Row> {
  readonly caption: string;
  readonly columns: readonly AdminDataTableColumn<Row>[];
  readonly rows: readonly Row[] | undefined;
  readonly rowKey: (row: Row) => string;
  readonly error?: { readonly message: string; readonly onRetry: () => void };
  readonly emptyMessage: string;
  readonly pagination?: AdminDataTablePagination;
}

const SKELETON_ROW_KEYS = ['first', 'second', 'third'] as const;

const TABLE_SKELETON = (
  <div className="flex flex-col gap-3">
    <Skeleton className="h-8 w-full" />
    {SKELETON_ROW_KEYS.map((key) => (
      <Skeleton key={key} className="h-6 w-full" />
    ))}
  </div>
);

function bodyOf<Row>({
  caption,
  columns,
  rows,
  rowKey,
  error,
  emptyMessage,
}: AdminDataTableProps<Row>): ReactNode {
  if (error !== undefined) {
    return <ErrorState message={error.message} onRetry={error.onRetry} />;
  }
  if (rows === undefined) {
    return <LoadingSkeleton>{TABLE_SKELETON}</LoadingSkeleton>;
  }
  if (rows.length === 0) {
    return <EmptyState title={emptyMessage} />;
  }
  // 見出しの題と重なる表の名前を画面に二重に出さず、支援技術と横スクロールの領域の名前にだけ使う
  return (
    <Table>
      <TableCaption className="sr-only">{caption}</TableCaption>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead
              key={column.key}
              scope="col"
              className={column.className}
            >
              {column.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={rowKey(row)}>
            {columns.map((column) => (
              <TableCell key={column.key} className={column.className}>
                {column.cell(row)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// 押した直後に最後のページや読み込み中へ変わるボタンをdisabledにしたり描かなくしたりすると、Chromiumがフォーカスを<body>へ移して操作の位置を失うため、ページ送りは描いたままaria-disabledで押せなくする
function PageButton({
  enabled,
  onPress,
  children,
}: {
  readonly enabled: boolean;
  readonly onPress: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      aria-disabled={enabled ? undefined : true}
      onClick={() => {
        if (enabled) {
          onPress();
        }
      }}
    >
      {children}
    </Button>
  );
}

export function AdminDataTable<Row>(props: AdminDataTableProps<Row>) {
  const { rows, error, pagination } = props;
  const loading = error === undefined && rows === undefined;
  const settled = error === undefined && rows !== undefined;
  return (
    <div data-slot="admin-data-table" className="flex flex-col gap-4">
      <div aria-busy={loading ? true : undefined}>{bodyOf(props)}</div>
      {pagination === undefined ? null : (
        <nav
          aria-label={ADMIN_PAGINATION_LABEL}
          className="flex flex-wrap justify-end gap-2"
        >
          <PageButton
            enabled={settled && pagination.hasPrevious}
            onPress={pagination.onPrevious}
          >
            <ChevronLeftIcon aria-hidden="true" />
            {PREVIOUS_PAGE_LABEL}
          </PageButton>
          <PageButton
            enabled={settled && pagination.hasNext}
            onPress={pagination.onNext}
          >
            {NEXT_PAGE_LABEL}
            <ChevronRightIcon aria-hidden="true" />
          </PageButton>
        </nav>
      )}
    </div>
  );
}
