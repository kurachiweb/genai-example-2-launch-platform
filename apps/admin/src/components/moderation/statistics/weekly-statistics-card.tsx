import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';

import { formatBusinessDateWithWeekdayLabel } from '../../../../common-lib/time/business-date-label.ts';
import { EmptyState } from '../../../../lib/components/state/empty-state.tsx';
import {
  adminWeeklyStatisticsQueryOptions,
  toAdminWeeklyStatistics,
} from '../../../graphql/admin-weekly-statistics.ts';
import { DashboardCardFrame } from '../../dashboard/dashboard-card-frame.tsx';
import { dashboardCardStateOf } from '../../dashboard/dashboard-card-state.ts';
import {
  NO_FINALIZED_WEEK_MESSAGE,
  NO_PREVIOUS_WEEK_TEXT,
  NO_STATISTICS_MESSAGE,
  STATISTICS_DELTA_PREFIX,
  STATISTICS_LATEST_WEEK_SUFFIX,
  STATISTICS_METRIC_LABELS,
  WEEKLY_STATISTICS_DESCRIPTION,
  WEEKLY_STATISTICS_TITLE,
} from './statistics-messages.ts';
import {
  type StatisticsLatestWeek,
  type StatisticsMetricSummary,
  statisticsSeriesOf,
} from './statistics-series.ts';
import { StatisticsValueText } from './statistics-value-text.tsx';
import { WeeklyStatisticsChart } from './weekly-statistics-chart.tsx';
import { WeeklyStatisticsTable } from './weekly-statistics-table.tsx';

function MetricDelta({ metric }: { readonly metric: StatisticsMetricSummary }) {
  if (metric.delta === null) {
    return <>{NO_PREVIOUS_WEEK_TEXT}</>;
  }
  return (
    <>
      {STATISTICS_DELTA_PREFIX}
      <StatisticsValueText metric={metric.key} value={metric.delta} signed />
    </>
  );
}

function LatestWeekSummary({
  latest,
}: {
  readonly latest: StatisticsLatestWeek;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h3 id={headingId} className="text-base font-bold">
        <time dateTime={latest.weekStart}>
          {formatBusinessDateWithWeekdayLabel(latest.weekStart)}
        </time>
        {STATISTICS_LATEST_WEEK_SUFFIX}
      </h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
        {latest.metrics.map((metric) => (
          <div key={metric.key} className="flex flex-col gap-1">
            <dt className="text-sm text-muted-foreground">
              {STATISTICS_METRIC_LABELS[metric.key]}
            </dt>
            <dd className="flex flex-col">
              <span className="text-2xl font-bold tabular-nums">
                <StatisticsValueText metric={metric.key} value={metric.value} />
              </span>
              <span className="text-sm text-muted-foreground tabular-nums">
                <MetricDelta metric={metric} />
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function WeeklyStatisticsCard() {
  const { data, error, isFetching, refetch } = useQuery(
    adminWeeklyStatisticsQueryOptions(),
  );
  const statistics =
    data === undefined
      ? undefined
      : statisticsSeriesOf(toAdminWeeklyStatistics(data).weeks);

  return (
    <DashboardCardFrame
      title={WEEKLY_STATISTICS_TITLE}
      state={dashboardCardStateOf({
        hasData: data !== undefined,
        error,
        isFetching,
        refetch,
      })}
    >
      <p className="text-sm text-muted-foreground">
        {WEEKLY_STATISTICS_DESCRIPTION}
      </p>
      {statistics === undefined || statistics.rows.length === 0 ? (
        <EmptyState title={NO_STATISTICS_MESSAGE} />
      ) : (
        <>
          {statistics.latestFinalized === null ? (
            <p>{NO_FINALIZED_WEEK_MESSAGE}</p>
          ) : (
            <LatestWeekSummary latest={statistics.latestFinalized} />
          )}
          <WeeklyStatisticsChart series={statistics.series} />
          <WeeklyStatisticsTable rows={statistics.rows} />
        </>
      )}
    </DashboardCardFrame>
  );
}
