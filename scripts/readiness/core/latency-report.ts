export interface LatencySample {
  readonly operation: string;
  readonly durationMs: number;
}

export interface TraceSpanRow {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly side: 'browser' | 'frontend' | 'api';
  readonly operation?: string;
  readonly durationMs: number;
}

export interface JoinedLatency {
  readonly samples: readonly LatencySample[];
  readonly unmatchedBrowserSpans: number;
}

export interface OperationLatency {
  readonly operation: string;
  readonly samples: number;
  readonly p95Ms: number;
  readonly verdict: 'pass' | 'fail' | 'insufficient';
}

export interface LatencyOptions {
  readonly thresholdMs: number;
  readonly minSamples: number;
  readonly operations?: readonly string[];
}

export interface LatencyReportOptions {
  readonly thresholdMs: number;
  readonly minSamples: number;
  readonly unmatchedBrowserSpans: number;
}

const P95 = 95;

const spanKeyOf = ({
  traceId,
  spanId,
}: Pick<TraceSpanRow, 'traceId' | 'spanId'>): string =>
  JSON.stringify([traceId, spanId]);

// 親をたどって最初に着いたブラウザのスパンのキーを返す。親の連なりが循環・途切れた場合はundefined
const browserAncestorKeyOf = (
  start: TraceSpanRow,
  rowsByKey: ReadonlyMap<string, TraceSpanRow>,
): string | undefined => {
  const visited = new Set<string>([spanKeyOf(start)]);
  let parentSpanId = start.parentSpanId;
  while (parentSpanId !== undefined) {
    const key = spanKeyOf({ traceId: start.traceId, spanId: parentSpanId });
    const parent = rowsByKey.get(key);
    if (parent === undefined || visited.has(key)) return undefined;
    if (parent.side === 'browser') return key;
    visited.add(key);
    parentSpanId = parent.parentSpanId;
  }
  return undefined;
};

export function joinBrowserSpansWithOperations(
  rows: readonly TraceSpanRow[],
): JoinedLatency {
  const rowsByKey = new Map(rows.map((row) => [spanKeyOf(row), row]));
  const operationByBrowserKey = new Map<string, string>();
  for (const row of rows) {
    if (row.side !== 'api' || row.operation === undefined) continue;
    const browserKey = browserAncestorKeyOf(row, rowsByKey);
    if (browserKey !== undefined && !operationByBrowserKey.has(browserKey)) {
      operationByBrowserKey.set(browserKey, row.operation);
    }
  }
  const samples: LatencySample[] = [];
  let unmatchedBrowserSpans = 0;
  for (const row of rows) {
    if (row.side !== 'browser') continue;
    const operation = operationByBrowserKey.get(spanKeyOf(row));
    if (operation === undefined) {
      unmatchedBrowserSpans += 1;
    } else {
      samples.push({ operation, durationMs: row.durationMs });
    }
  }
  return { samples, unmatchedBrowserSpans };
}

// 最近接順位法: 昇順に並べた値のうち、ceil(p/100 * 件数)番目の値
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) {
    throw new RangeError('値が空のためパーセンタイルを求められません');
  }
  if (!(p >= 0 && p <= 100)) {
    throw new RangeError(`割合は0以上100以下で指定してください: ${String(p)}`);
  }
  const sorted = values.toSorted((left, right) => left - right);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] as number;
}

const groupByOperation = (
  samples: readonly LatencySample[],
): ReadonlyMap<string, readonly number[]> => {
  const groups = new Map<string, number[]>();
  for (const { operation, durationMs } of samples) {
    const durations = groups.get(operation);
    if (durations === undefined) {
      groups.set(operation, [durationMs]);
    } else {
      durations.push(durationMs);
    }
  }
  return groups;
};

const judge = (
  operation: string,
  durations: readonly number[],
  { thresholdMs, minSamples }: LatencyOptions,
): OperationLatency => {
  if (durations.length === 0) {
    return {
      operation,
      samples: 0,
      p95Ms: Number.NaN,
      verdict: 'insufficient',
    };
  }
  const p95Ms = percentile(durations, P95);
  const verdict =
    durations.length < minSamples
      ? 'insufficient'
      : p95Ms > thresholdMs
        ? 'fail'
        : 'pass';
  return { operation, samples: durations.length, p95Ms, verdict };
};

export function summarizeLatency(
  samples: readonly LatencySample[],
  options: LatencyOptions,
): readonly OperationLatency[] {
  const groups = groupByOperation(samples);
  const operations =
    options.operations === undefined
      ? [...groups.keys()].toSorted()
      : [...new Set(options.operations)];
  return operations.map((operation) =>
    judge(operation, groups.get(operation) ?? [], options),
  );
}

const VERDICT_LABELS: Readonly<Record<OperationLatency['verdict'], string>> = {
  pass: '合格',
  fail: '不合格',
  insufficient: '標本不足',
};

const escapeCell = (text: string): string => text.replaceAll('|', '\\|');

const rowOf = ({ operation, samples, p95Ms, verdict }: OperationLatency) =>
  `| ${escapeCell(operation)} | ${String(samples)} | ${
    Number.isNaN(p95Ms) ? '-' : String(p95Ms)
  } | ${VERDICT_LABELS[verdict]} |`;

export function formatLatencyReport(
  results: readonly OperationLatency[],
  { thresholdMs, minSamples, unmatchedBrowserSpans }: LatencyReportOptions,
): string {
  const table =
    results.length === 0
      ? ['判定できる標本がありません。']
      : [
          '| 操作 | 標本数 | 95パーセンタイル(ms) | 判定 |',
          '| --- | ---: | ---: | --- |',
          ...results.map(rowOf),
        ];
  return [
    ...table,
    '',
    `閾値${String(thresholdMs)}ms・最小の標本${String(minSamples)}件`,
    `結べなかったブラウザのスパン: ${String(unmatchedBrowserSpans)}件`,
    '',
  ].join('\n');
}
