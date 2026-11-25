import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';

import { useDisplayPreferences } from '../../../../lib/components/datetime/use-display-preferences.ts';
import { formatNumber } from '../../../../lib/utilities/number/number-format.ts';
import {
  chartAxisFormatOf,
  chartPointsOf,
  chartWeekTickOf,
} from './statistics-chart-values.ts';
import { STATISTICS_METRIC_LABELS } from './statistics-messages.ts';
import type { StatisticsMetricSeries } from './statistics-series.ts';
import {
  CHART_CELL_CLASS_NAME,
  CHART_GRID_CLASS_NAME,
} from './weekly-statistics-chart-layout.ts';

export interface WeeklyStatisticsLineChartsProps {
  readonly series: readonly StatisticsMetricSeries[];
}

// 配色のトークンのCSSの変数を属性で渡し、ライトとダークの切り替えに追従させる
const LINE_COLOR = 'var(--primary)';
const AXIS_TEXT_COLOR = 'var(--muted-foreground)';
const GRID_COLOR = 'var(--border)';

const AXIS_TICK = Object.freeze({ fill: AXIS_TEXT_COLOR, fontSize: 12 });
const CHART_MARGIN = Object.freeze({ top: 8, right: 12, bottom: 0, left: 0 });
const LINE_DOT = Object.freeze({
  r: 2,
  fill: LINE_COLOR,
  stroke: LINE_COLOR,
});
const Y_AXIS_WIDTH = 64;
const X_AXIS_MIN_TICK_GAP = 16;

export function WeeklyStatisticsLineCharts({
  series,
}: WeeklyStatisticsLineChartsProps) {
  const preferences = useDisplayPreferences();

  return (
    <div className={CHART_GRID_CLASS_NAME}>
      {series.map((metricSeries) => {
        const axisFormat = chartAxisFormatOf(metricSeries.key);
        return (
          <div
            key={metricSeries.key}
            data-slot="weekly-statistics-chart-cell"
            className={CHART_CELL_CLASS_NAME}
          >
            <p className="text-sm font-medium">
              {STATISTICS_METRIC_LABELS[metricSeries.key]}
            </p>
            <div className="min-h-0 flex-1">
              {/* 図は読み上げから外して同じ値の表を正とするため、Rechartsの読み上げとキー操作の層を使わない */}
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={[...chartPointsOf(metricSeries)]}
                  margin={CHART_MARGIN}
                  accessibilityLayer={false}
                >
                  <CartesianGrid vertical={false} stroke={GRID_COLOR} />
                  <XAxis
                    dataKey="weekStart"
                    tickFormatter={chartWeekTickOf}
                    tick={AXIS_TICK}
                    stroke={GRID_COLOR}
                    tickLine={false}
                    interval="preserveStartEnd"
                    minTickGap={X_AXIS_MIN_TICK_GAP}
                  />
                  <YAxis
                    width={Y_AXIS_WIDTH}
                    tickFormatter={(value: number) =>
                      formatNumber(value, preferences, axisFormat)
                    }
                    tick={AXIS_TICK}
                    stroke={GRID_COLOR}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Line
                    type="linear"
                    dataKey="value"
                    stroke={LINE_COLOR}
                    strokeWidth={2}
                    dot={LINE_DOT}
                    activeDot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })}
    </div>
  );
}
