import { type ComponentType, lazy, type LazyExoticComponent } from 'react';

import type { WeeklyStatisticsLineChartsProps } from './weekly-statistics-line-charts.tsx';

export type WeeklyStatisticsLineChartsComponent =
  ComponentType<WeeklyStatisticsLineChartsProps>;

export interface WeeklyStatisticsLineChartsModule {
  readonly WeeklyStatisticsLineCharts: WeeklyStatisticsLineChartsComponent;
}

export type ImportWeeklyStatisticsLineCharts =
  () => Promise<WeeklyStatisticsLineChartsModule>;

// Rechartsをダッシュボードの最初の読み込みに含めないため、グラフの部品を別のチャンクにしてブラウザで後から読み込む
export const importWeeklyStatisticsLineCharts: ImportWeeklyStatisticsLineCharts =
  () => import('./weekly-statistics-line-charts.tsx');

export const loadWeeklyStatisticsLineCharts = (
  importCharts: ImportWeeklyStatisticsLineCharts = importWeeklyStatisticsLineCharts,
): LazyExoticComponent<WeeklyStatisticsLineChartsComponent> =>
  lazy(async () => ({
    default: (await importCharts()).WeeklyStatisticsLineCharts,
  }));
