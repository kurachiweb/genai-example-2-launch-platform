import { AsyncLocalStorage } from 'node:async_hooks';

import {
  type Config,
  type ConsoleFormatter,
  configureSync,
  getConfig,
  getConsoleSink,
  getLogger,
  type Logger,
  type LogRecord,
  withContext,
} from '@logtape/logtape';
import {
  DEFAULT_REDACT_FIELDS,
  type FieldPattern,
  redactByField,
  redactByPattern,
} from '@logtape/redaction';

import {
  REDACTED,
  REDACTION_PATTERNS,
} from '../../utilities/observability/redaction-patterns.ts';
import type { CallerKind } from '../entry/app-profile.ts';
import type { FrontendLogLevel } from '../env/frontend-env.ts';

export interface FrontendLoggingOptions {
  readonly caller: CallerKind;
  readonly level: FrontendLogLevel;
  readonly console?: Console;
}

export interface AccessLogRecord {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly durationMs: number;
  readonly correlationId: string;
  readonly outcome: 'page' | 'relay' | 'rejected' | 'static_error';
}

interface LogObject {
  readonly time: string;
  readonly level: LogRecord['level'];
  readonly category: string;
  readonly message: string;
  readonly [property: string]: unknown;
}

type SerializedCause = SerializedError | string | number | boolean;

interface SerializedError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly cause?: SerializedCause;
}

interface AppliedLogging {
  readonly caller: CallerKind;
  readonly level: FrontendLogLevel;
  readonly console: Console;
  readonly config: Config<string, string>;
}

// backend-libのREDACTED_FIELD_PATTERNSの写し。片方を変えたらもう片方も見直す
export const REDACTED_FIELD_PATTERNS: readonly FieldPattern[] = Object.freeze([
  ...DEFAULT_REDACT_FIELDS,
  /^ip$/i,
  /^ipAddress$/i,
  /^clientIp$/i,
  /^remoteIp$/i,
  /^email$/i,
  /^mail$/i,
  /cookie/i,
  /^authorization$/i,
  /^token$/i,
  /^turnstileToken$/i,
  /^pepper$/i,
  /^secret$/i,
]);

const LOG_LEVELS: ReadonlySet<string> = new Set<FrontendLogLevel>([
  'debug',
  'info',
  'warning',
  'error',
]);

// 不正なLOG_LEVELは環境の検証で失敗させるため、その失敗のログを出せるよう既定のレベルで設定する
const FALLBACK_LEVEL: FrontendLogLevel = 'info';

const CONSOLE_SINK_ID = 'console';

// LogTapeのmetaロガーを設定しないと、伏せ字を通らない既定のコンソールシンクが付き、設定完了の通知(info)も出る。LogTape自身の警告以上だけを同じ伏せ字付きの出力先へ流す
const META_LOGGER_CATEGORY = ['logtape', 'meta'];
const META_LOGGER_LOWEST_LEVEL = 'warning';

const CATEGORY_SEPARATOR = '.';

const ACCESS_LOG_MESSAGE = 'HTTPリクエストを処理しました';

let applied: AppliedLogging | undefined;
// 設定し直しても進行中の要求の文脈を失わないよう、isolateで1つのストアを使い続ける
let contextLocalStorage: AsyncLocalStorage<Record<string, unknown>> | undefined;

const renderMessageValue = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Error || typeof value !== 'object' || value === null) {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
};

// LogRecordのmessageは偶数番目がテンプレートの文字列、奇数番目が差し込み値の配列である
const renderMessage = (parts: readonly unknown[]): string =>
  parts
    .map((part, index) =>
      index % 2 === 0 ? String(part) : renderMessageValue(part),
    )
    .join('');

// フィールド名による伏せ字はErrorの中を走査しないため、原因に入れたオブジェクトは属性名で伏せられないまま出力される。値の形式で伏せられる文字列とプリミティブ値、再帰的に開くErrorだけを残す
const serializeCause = (
  cause: unknown,
  visited: ReadonlySet<Error>,
): SerializedCause | undefined => {
  if (cause instanceof Error) {
    return visited.has(cause) ? undefined : serializeError(cause, visited);
  }
  if (
    typeof cause === 'string' ||
    typeof cause === 'number' ||
    typeof cause === 'boolean'
  ) {
    return cause;
  }
  return undefined;
};

// ErrorはJSONにすると空のオブジェクトになり、値の形式による伏せ字も組み込みのオブジェクトの中を走査しないため、通常のオブジェクトにする。独自のプロパティはフィールド名による伏せ字を通らないため含めない
const serializeError = (
  error: Error,
  visited: ReadonlySet<Error> = new Set(),
): SerializedError => {
  const cause = serializeCause(error.cause, new Set([...visited, error]));
  return {
    name: error.name,
    message: error.message,
    ...(typeof error.stack === 'string' ? { stack: error.stack } : {}),
    ...(cause === undefined ? {} : { cause }),
  };
};

const toLogObject = (record: LogRecord): LogObject => {
  const base = {
    time: new Date(record.timestamp).toISOString(),
    level: record.level,
    category: record.category.join(CATEGORY_SEPARATOR),
    message: renderMessage(record.message),
  };
  const properties = Object.fromEntries(
    Object.entries(record.properties).map(([key, value]) => [
      key,
      value instanceof Error ? serializeError(value) : value,
    ]),
  );
  // 先頭に基本の項目を並べたまま、同名の属性があっても基本の項目の値を保つ
  return { ...base, ...properties, ...base };
};

const objectConsoleFormatter: ConsoleFormatter = (record) => [
  toLogObject(record),
];

const isApplied = (
  caller: CallerKind,
  level: FrontendLogLevel,
  output: Console,
): boolean =>
  applied !== undefined &&
  applied.config === getConfig() &&
  applied.caller === caller &&
  applied.level === level &&
  applied.console === output;

export const ensureFrontendLoggingConfigured = (
  options: FrontendLoggingOptions,
): void => {
  const level = LOG_LEVELS.has(options.level) ? options.level : FALLBACK_LEVEL;
  const output = options.console ?? console;
  if (isApplied(options.caller, level, output)) {
    return;
  }
  contextLocalStorage ??= new AsyncLocalStorage();
  const config: Config<typeof CONSOLE_SINK_ID, never> = {
    reset: true,
    sinks: {
      [CONSOLE_SINK_ID]: redactByField(
        getConsoleSink({
          console: output,
          formatter: redactByPattern(
            objectConsoleFormatter,
            REDACTION_PATTERNS,
          ),
        }),
        {
          fieldPatterns: [...REDACTED_FIELD_PATTERNS],
          action: () => REDACTED,
        },
      ),
    },
    loggers: [
      {
        category: [options.caller],
        sinks: [CONSOLE_SINK_ID],
        lowestLevel: level,
      },
      {
        category: META_LOGGER_CATEGORY,
        sinks: [CONSOLE_SINK_ID],
        lowestLevel: META_LOGGER_LOWEST_LEVEL,
      },
    ],
    contextLocalStorage,
  };
  configureSync(config);
  applied = { caller: options.caller, level, console: output, config };
};

export const getFrontendLogger = (
  category: readonly [CallerKind, ...string[]],
): Logger => getLogger(category);

export const withCorrelationId = <T>(
  correlationId: string,
  callback: () => T,
): T => withContext({ correlationId }, callback);

// 呼び出し側が渡し誤っても、クエリやフラグメントに入り得るトークン・メールアドレスを出さない
const withoutQuery = (path: string): string => {
  const end = path.search(/[?#]/u);
  return end === -1 ? path : path.slice(0, end);
};

export const logAccess = (
  caller: CallerKind,
  record: AccessLogRecord,
): void => {
  getFrontendLogger([caller, 'http', 'access']).info(ACCESS_LOG_MESSAGE, {
    method: record.method,
    path: withoutQuery(record.path),
    status: record.status,
    durationMs: record.durationMs,
    correlationId: record.correlationId,
    outcome: record.outcome,
  });
};
