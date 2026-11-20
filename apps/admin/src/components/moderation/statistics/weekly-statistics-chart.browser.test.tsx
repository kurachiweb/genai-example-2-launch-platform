import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../../styles.css';
import { reportUnexpectedErrorInBrowser } from '../../../../lib/start/observability/browser-error-reporting.ts';
import { renderModerationPart } from '../../../../test/moderation-render.tsx';
import {
  STATISTICS_WEEKS,
  statisticsWeekViewOf,
} from '../../../../test/moderation-statistics-fixtures.ts';
import {
  importWeeklyStatisticsLineCharts,
  loadWeeklyStatisticsLineCharts,
} from './load-weekly-statistics-line-charts.ts';
import { statisticsSeriesOf } from './statistics-series.ts';
import { WeeklyStatisticsChart } from './weekly-statistics-chart.tsx';

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

vi.mock('./load-weekly-statistics-line-charts.ts', async (importOriginal) => {
  const actual = await importOriginal<{
    readonly loadWeeklyStatisticsLineCharts: typeof loadWeeklyStatisticsLineCharts;
  }>();
  return {
    ...actual,
    loadWeeklyStatisticsLineCharts: vi.fn(
      actual.loadWeeklyStatisticsLineCharts,
    ),
  };
});

vi.mock('../../../../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

const { loadWeeklyStatisticsLineCharts: actualLoadLineCharts } =
  await vi.importActual<{
    readonly loadWeeklyStatisticsLineCharts: typeof loadWeeklyStatisticsLineCharts;
  }>('./load-weekly-statistics-line-charts.ts');

const CHART_SELECTOR = '[data-slot="weekly-statistics-chart"]';
const PLACEHOLDER_SELECTOR =
  '[data-slot="weekly-statistics-chart-placeholder"]';
const FOLLOWING_TEXT = 'グラフの後の表示';

const { series } = statisticsSeriesOf(
  STATISTICS_WEEKS.map(statisticsWeekViewOf),
);

const chartOf = (): HTMLElement => {
  const chart = document.querySelector<HTMLElement>(CHART_SELECTOR);
  if (chart === null) {
    throw new Error('統計のグラフの枠がありません。');
  }
  return chart;
};

const heightOf = (element: Element): number =>
  element.getBoundingClientRect().height;

const chartSurfaceCount = (): number =>
  chartOf().querySelectorAll('svg.recharts-surface').length;

const renderChart = () =>
  renderModerationPart(
    <>
      <WeeklyStatisticsChart series={series} />
      <p>{FOLLOWING_TEXT}</p>
    </>,
    { role: 'VIEWER' },
  );

beforeEach(async () => {
  vi.mocked(loadWeeklyStatisticsLineCharts).mockClear();
  vi.mocked(reportUnexpectedErrorInBrowser).mockClear();
  await page.viewport(1280, 800);
});

describe('WeeklyStatisticsChart', () => {
  test('サーバー側の描画では、読み上げから外した同じ高さの空の枠の目印だけを出し、グラフを描かない', () => {
    const html = renderToString(<WeeklyStatisticsChart series={series} />);

    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const chart = parsed.querySelector(CHART_SELECTOR);
    expect(chart?.getAttribute('aria-hidden')).toBe('true');
    expect(chart?.querySelector(PLACEHOLDER_SELECTOR)).not.toBeNull();
    expect(parsed.querySelector('svg')).toBeNull();
    expect(html).not.toContain('recharts');
  });

  test('ブラウザでは遅延読み込みの後に5つの指標のグラフを描く', async () => {
    await renderChart();

    await expect.poll(chartSurfaceCount).toBe(5);
    expect(chartOf().querySelector(PLACEHOLDER_SELECTOR)).toBeNull();
    expect(loadWeeklyStatisticsLineCharts).toHaveBeenCalledTimes(1);
  });

  test('読み込み中は空の枠を示し、グラフを描いた後も画面の幅ごとに枠の高さを変えない', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(loadWeeklyStatisticsLineCharts).mockImplementationOnce(() =>
      actualLoadLineCharts(() => gate.then(importWeeklyStatisticsLineCharts)),
    );
    await page.viewport(400, 800);
    await renderChart();
    await expect
      .poll(() => chartOf().querySelector(PLACEHOLDER_SELECTOR))
      .not.toBeNull();
    const narrowLoadingHeight = heightOf(chartOf());
    await page.viewport(1280, 800);
    await expect.poll(() => heightOf(chartOf())).not.toBe(narrowLoadingHeight);
    const wideLoadingHeight = heightOf(chartOf());
    expect(chartOf().querySelector('svg')).toBeNull();
    expect(wideLoadingHeight).toBeGreaterThan(0);

    release();

    await expect.poll(chartSurfaceCount).toBe(5);
    expect(chartOf().querySelector(PLACEHOLDER_SELECTOR)).toBeNull();
    expect(heightOf(chartOf())).toBe(wideLoadingHeight);
    await page.viewport(400, 800);
    await expect.poll(() => heightOf(chartOf())).toBe(narrowLoadingHeight);
  });

  test('グラフの読み込みに失敗しても、空の枠を残して周りの表示を止めず、想定外の失敗として報告する', async () => {
    const failure = new Error('グラフの読み込みの失敗');
    vi.mocked(loadWeeklyStatisticsLineCharts).mockImplementationOnce(() =>
      actualLoadLineCharts(() => Promise.reject(failure)),
    );

    await renderChart();

    await expect
      .poll(() => vi.mocked(reportUnexpectedErrorInBrowser).mock.calls)
      .toStrictEqual([[failure, 'render']]);
    await expect.element(page.getByText(FOLLOWING_TEXT)).toBeVisible();
    expect(chartOf().querySelector(PLACEHOLDER_SELECTOR)).not.toBeNull();
    expect(chartOf().querySelector('svg')).toBeNull();
  });
});
