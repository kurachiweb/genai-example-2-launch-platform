import { CatchBoundary, ClientOnly } from '@tanstack/react-router';
import { Suspense, useState } from 'react';

import { reportUnexpectedErrorInBrowser } from '../../../../lib/start/observability/browser-error-reporting.ts';
import { cn } from '../../../../lib/utilities/class-names.ts';
import {
  loadWeeklyStatisticsLineCharts,
  type WeeklyStatisticsLineChartsComponent,
} from './load-weekly-statistics-line-charts.ts';
import type { StatisticsMetricSeries } from './statistics-series.ts';
import {
  CHART_CELL_CLASS_NAME,
  CHART_GRID_CLASS_NAME,
} from './weekly-statistics-chart-layout.ts';

export interface WeeklyStatisticsChartProps {
  readonly series: readonly StatisticsMetricSeries[];
}

const CHART_RESET_KEY = 'weekly-statistics-chart';

function ChartPlaceholder({ count }: { readonly count: number }) {
  return (
    <div
      data-slot="weekly-statistics-chart-placeholder"
      className={CHART_GRID_CLASS_NAME}
    >
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className={cn(CHART_CELL_CLASS_NAME, 'rounded-md bg-muted')}
        />
      ))}
    </div>
  );
}

interface LoadedLineChartsProps extends WeeklyStatisticsChartProps {
  readonly LineCharts: WeeklyStatisticsLineChartsComponent;
}

function LoadedLineCharts({ LineCharts, series }: LoadedLineChartsProps) {
  return <LineCharts series={series} />;
}

// 図は読み上げから外し、同じ値を示す表を読み上げとキーボードの操作で読む正とする
export function WeeklyStatisticsChart({ series }: WeeklyStatisticsChartProps) {
  const [LineCharts] = useState(() => loadWeeklyStatisticsLineCharts());
  const placeholder = <ChartPlaceholder count={series.length} />;

  return (
    <div data-slot="weekly-statistics-chart" aria-hidden="true">
      <ClientOnly fallback={placeholder}>
        {/* グラフの読み込みや描画の失敗でカードの値と表の表示を止めないよう、空の枠を残す */}
        <CatchBoundary
          getResetKey={() => CHART_RESET_KEY}
          errorComponent={() => placeholder}
          onCatch={(error) => {
            reportUnexpectedErrorInBrowser(error, 'render');
          }}
        >
          <Suspense fallback={placeholder}>
            <LoadedLineCharts LineCharts={LineCharts} series={series} />
          </Suspense>
        </CatchBoundary>
      </ClientOnly>
    </div>
  );
}
