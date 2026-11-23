import { sleep } from 'k6';
import http from 'k6/http';
import { Counter, Rate, Trend } from 'k6/metrics';

import {
  buildOptions,
  classifyStatus,
  formatLatencyTable,
  type LatencyRow,
  resolveLoadSettings,
  ROUTE_NAMES,
  visitPlan,
  waitSeconds,
} from './browse-plan.ts';

interface MetricValues {
  readonly [stat: string]: number | undefined;
}

interface SummaryData {
  readonly metrics: Readonly<
    Record<
      string,
      {
        readonly values?: MetricValues;
        readonly thresholds?: Readonly<
          Record<string, { readonly ok: boolean }>
        >;
      }
    >
  >;
}

const settings = resolveLoadSettings(__ENV);

export const options = buildOptions(settings);

const serverErrors = new Rate('server_errors');
const rateLimitedResponses = new Counter('rate_limited_responses');
const unexpectedResponses = new Counter('unexpected_responses');

const metricNameOf = (route: string): string =>
  `route_${route.replaceAll('-', '_')}`;

const routeDurations = Object.fromEntries(
  ROUTE_NAMES.map((route) => [route, new Trend(metricNameOf(route), true)]),
);

function record(route: string, status: number, durationMs: number): void {
  const statusClass = classifyStatus(status);
  serverErrors.add(statusClass === 'server_error');
  if (statusClass === 'rate_limited') rateLimitedResponses.add(1);
  if (statusClass !== 'ok') unexpectedResponses.add(1);
  routeDurations[route]?.add(durationMs);
}

export default function browse(): void {
  for (const { route, url } of visitPlan(settings, __VU - 1)) {
    const response = http.get(url, { tags: { route } });
    record(route, response.status, response.timings.duration);
    sleep(waitSeconds(Math.random()));
  }
}

const rowsOf = (data: SummaryData): readonly LatencyRow[] =>
  [
    ...ROUTE_NAMES.map((route) => ({
      operation: route,
      values: data.metrics[metricNameOf(route)]?.values,
    })),
    { operation: '全体', values: data.metrics.http_req_duration?.values },
  ].map(({ operation, values }) => ({
    operation,
    samples: values?.count ?? 0,
    p95Ms: values?.['p(95)'] ?? Number.NaN,
  }));

const thresholdLines = (data: SummaryData): readonly string[] =>
  Object.entries(data.metrics).flatMap(([name, metric]) =>
    Object.entries(metric.thresholds ?? {}).map(
      ([expression, { ok }]) =>
        `${ok ? '合格' : '不合格'}: ${name} ${expression}`,
    ),
  );

export function handleSummary(data: SummaryData): Record<string, string> {
  const report = [
    formatLatencyTable(rowsOf(data)),
    '',
    ...thresholdLines(data),
    '',
  ].join('\n');
  return {
    stdout: report,
    ...(settings.summaryPath === undefined
      ? {}
      : { [settings.summaryPath]: JSON.stringify(data, null, 2) }),
  };
}
