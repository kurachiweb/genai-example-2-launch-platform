import { formatBusinessDateWithWeekdayLabel } from '../../../../common-lib/time/business-date-label.ts';
import {
  AdminDataTable,
  type AdminDataTableColumn,
} from '../../../../lib/components/admin/admin-data-table.tsx';
import {
  NO_STATISTICS_MESSAGE,
  STATISTICS_IN_PROGRESS_LABEL,
  STATISTICS_METRIC_LABELS,
  STATISTICS_TABLE_CAPTION,
  STATISTICS_WEEK_START_COLUMN,
} from './statistics-messages.ts';
import {
  STATISTICS_METRIC_KEYS,
  type StatisticsTableRow,
} from './statistics-series.ts';
import { StatisticsValueText } from './statistics-value-text.tsx';

export interface WeeklyStatisticsTableProps {
  // 週の新しい順
  readonly rows: readonly StatisticsTableRow[];
}

// 週の開始日は時刻を持たない業務日付のため、日時の表示部品に渡さず暦日のまま示す
function WeekStartCell({ row }: { readonly row: StatisticsTableRow }) {
  return (
    <span className="whitespace-nowrap">
      <time dateTime={row.weekStart}>
        {formatBusinessDateWithWeekdayLabel(row.weekStart)}
      </time>
      {row.inProgress ? (
        <span className="ml-2 rounded-sm border border-border px-1.5 py-0.5 text-xs font-medium">
          {STATISTICS_IN_PROGRESS_LABEL}
        </span>
      ) : null}
    </span>
  );
}

const COLUMNS: readonly AdminDataTableColumn<StatisticsTableRow>[] =
  Object.freeze([
    {
      key: 'weekStart',
      header: STATISTICS_WEEK_START_COLUMN,
      cell: (row: StatisticsTableRow) => <WeekStartCell row={row} />,
    },
    ...STATISTICS_METRIC_KEYS.map((metric) => ({
      key: metric,
      header: STATISTICS_METRIC_LABELS[metric],
      className: 'text-right tabular-nums',
      cell: (row: StatisticsTableRow) => (
        <StatisticsValueText metric={metric} value={row.values[metric]} />
      ),
    })),
  ]);

export function WeeklyStatisticsTable({ rows }: WeeklyStatisticsTableProps) {
  return (
    <AdminDataTable
      caption={STATISTICS_TABLE_CAPTION}
      columns={COLUMNS}
      rows={rows}
      rowKey={(row) => row.weekStart}
      emptyMessage={NO_STATISTICS_MESSAGE}
    />
  );
}
