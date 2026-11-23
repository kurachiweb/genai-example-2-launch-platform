import { parseArgs } from 'node:util';

import {
  CsvFormatError,
  type CsvRecord,
  type CsvTable,
  readCsvFile,
  requireColumns,
} from '../adapters/csv-source.ts';
import {
  formatLatencyReport,
  joinBrowserSpansWithOperations,
  summarizeLatency,
  type TraceSpanRow,
} from '../core/latency-report.ts';
import {
  EXIT_FAILURE,
  EXIT_SUCCESS,
  type ReadinessCommandModule,
  type ReadinessRun,
  UsageError,
} from './shared/readiness-command.ts';

const DEFAULT_THRESHOLD_MS = 300;
const DEFAULT_MIN_SAMPLES = 200;

const COLUMN_DEFAULTS = {
  'trace-id-column': 'trace_id',
  'span-id-column': 'span_id',
  'parent-span-id-column': 'parent_span_id',
  'side-column': 'side',
  'operation-column': 'operation',
  'duration-column': 'duration_ms',
} as const;

const SIDES: ReadonlySet<string> = new Set(['browser', 'frontend', 'api']);

interface ColumnNames {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string;
  readonly side: string;
  readonly operation: string;
  readonly duration: string;
}

interface Settings {
  readonly input: string;
  readonly columns: ColumnNames;
  readonly thresholdMs: number;
  readonly minSamples: number;
  readonly operations: readonly string[] | undefined;
}

export interface GraphqlLatencyDeps {
  readonly readCsv: (path: string) => Promise<CsvTable>;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const parseOptions = (args: readonly string[]) => {
  try {
    return parseArgs({
      args: [...args],
      strict: true,
      allowPositionals: false,
      options: {
        input: { type: 'string' },
        'threshold-ms': { type: 'string' },
        'min-samples': { type: 'string' },
        operation: { type: 'string', multiple: true },
        'trace-id-column': { type: 'string' },
        'span-id-column': { type: 'string' },
        'parent-span-id-column': { type: 'string' },
        'side-column': { type: 'string' },
        'operation-column': { type: 'string' },
        'duration-column': { type: 'string' },
      },
    }).values;
  } catch (error) {
    throw new UsageError(messageOf(error));
  }
};

const numberOption = (
  name: string,
  text: string | undefined,
  fallback: number,
  isValid: (value: number) => boolean,
  expectation: string,
): number => {
  if (text === undefined) return fallback;
  const value = text.trim() === '' ? Number.NaN : Number(text);
  if (!isValid(value)) {
    throw new UsageError(
      `--${name}は${expectation}で指定してください: ${text}`,
    );
  }
  return value;
};

const settingsOf = (args: readonly string[]): Settings => {
  const values = parseOptions(args);
  if (values.input === undefined) {
    throw new UsageError('--inputでCSVのパスを指定してください');
  }
  const column = (name: keyof typeof COLUMN_DEFAULTS): string =>
    values[name] ?? COLUMN_DEFAULTS[name];
  return {
    input: values.input,
    columns: {
      traceId: column('trace-id-column'),
      spanId: column('span-id-column'),
      parentSpanId: column('parent-span-id-column'),
      side: column('side-column'),
      operation: column('operation-column'),
      duration: column('duration-column'),
    },
    thresholdMs: numberOption(
      'threshold-ms',
      values['threshold-ms'],
      DEFAULT_THRESHOLD_MS,
      (value) => Number.isFinite(value) && value >= 0,
      '0以上の数',
    ),
    minSamples: numberOption(
      'min-samples',
      values['min-samples'],
      DEFAULT_MIN_SAMPLES,
      (value) => Number.isInteger(value) && value >= 1,
      '1以上の整数',
    ),
    operations: values.operation,
  };
};

const nonEmpty = (value: string): string | undefined =>
  value === '' ? undefined : value;

const spanRowOf = (
  record: CsvRecord,
  columns: ColumnNames,
  line: number,
): TraceSpanRow => {
  const side = record[columns.side] as string;
  if (!SIDES.has(side)) {
    throw new UsageError(
      `${String(line)}行目: 行の種類は browser・frontend・api のいずれかです: ${side}`,
    );
  }
  const durationText = record[columns.duration] as string;
  const durationMs =
    durationText.trim() === '' ? Number.NaN : Number(durationText);
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new UsageError(
      `${String(line)}行目: 所要時間は0以上の数で指定してください: ${durationText}`,
    );
  }
  const parentSpanId = nonEmpty(record[columns.parentSpanId] as string);
  const operation = nonEmpty(record[columns.operation] as string);
  return {
    traceId: record[columns.traceId] as string,
    spanId: record[columns.spanId] as string,
    side: side as TraceSpanRow['side'],
    durationMs,
    ...(parentSpanId === undefined ? {} : { parentSpanId }),
    ...(operation === undefined ? {} : { operation }),
  };
};

const loadRows = async (
  { input, columns }: Settings,
  deps: GraphqlLatencyDeps,
): Promise<readonly TraceSpanRow[]> => {
  let table: CsvTable;
  try {
    table = await deps.readCsv(input);
    requireColumns(table.columns, Object.values(columns));
  } catch (error) {
    const reason = error instanceof CsvFormatError ? '' : '読み込めません: ';
    throw new UsageError(`${reason}${input}: ${messageOf(error)}`);
  }
  return table.records.map((record, index) =>
    spanRowOf(record, columns, table.lines[index] as number),
  );
};

export const createRun =
  (deps: GraphqlLatencyDeps): ReadinessRun =>
  async (args, { stdout }) => {
    const settings = settingsOf(args);
    const rows = await loadRows(settings, deps);
    const { samples, unmatchedBrowserSpans } =
      joinBrowserSpansWithOperations(rows);
    const { thresholdMs, minSamples, operations } = settings;
    const results = summarizeLatency(samples, {
      thresholdMs,
      minSamples,
      ...(operations === undefined ? {} : { operations }),
    });
    stdout.write(
      formatLatencyReport(results, {
        thresholdMs,
        minSamples,
        unmatchedBrowserSpans,
      }),
    );
    const allPassed =
      results.length > 0 && results.every(({ verdict }) => verdict === 'pass');
    return allPassed ? EXIT_SUCCESS : EXIT_FAILURE;
  };

export const run: ReadinessCommandModule['run'] = createRun({
  readCsv: readCsvFile,
});
