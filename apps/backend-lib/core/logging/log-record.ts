import type { ConsoleFormatter, LogRecord } from '@logtape/logtape';

export interface LogObject {
  readonly time: string;
  readonly level: 'trace' | 'debug' | 'info' | 'warning' | 'error' | 'fatal';
  readonly category: string;
  readonly message: string;
  readonly [property: string]: unknown;
}

interface SerializedError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly cause?: SerializedCause;
}

const CATEGORY_SEPARATOR = '.';

function renderMessageValue(value: unknown): string {
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
}

// LogRecordのmessageは偶数番目がテンプレートの文字列、奇数番目が差し込み値の配列である
function renderMessage(parts: readonly unknown[]): string {
  return parts
    .map((part, index) =>
      index % 2 === 0 ? String(part) : renderMessageValue(part),
    )
    .join('');
}

type SerializedCause = SerializedError | string | number | boolean;

// フィールド名による伏せ字はErrorの中を走査しないため、原因に入れたオブジェクトは属性名で伏せられないまま出力される。値の形式で伏せられる文字列とプリミティブ値、再帰的に開くErrorだけを残す
function serializeCause(
  cause: unknown,
  visited: ReadonlySet<Error>,
): SerializedCause | undefined {
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
}

// ErrorはJSONにすると空のオブジェクトになり、伏せ字の値のパターンも組み込みのオブジェクトの中を走査しないため、通常のオブジェクトにする。独自のプロパティはフィールド名による伏せ字を通らないため含めない
function serializeError(
  error: Error,
  visited: ReadonlySet<Error> = new Set(),
): SerializedError {
  const cause = serializeCause(error.cause, new Set([...visited, error]));
  return {
    name: error.name,
    message: error.message,
    ...(typeof error.stack === 'string' ? { stack: error.stack } : {}),
    ...(cause === undefined ? {} : { cause }),
  };
}

function serializeProperties(
  properties: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties).map(([key, value]) => [
      key,
      value instanceof Error ? serializeError(value) : value,
    ]),
  );
}

export function toLogObject(record: LogRecord): LogObject {
  const base = {
    time: new Date(record.timestamp).toISOString(),
    level: record.level,
    category: record.category.join(CATEGORY_SEPARATOR),
    message: renderMessage(record.message),
  };
  // 先頭に基本の項目を並べたまま、同名の属性があっても基本の項目の値を保つ
  return { ...base, ...serializeProperties(record.properties), ...base };
}

export const objectConsoleFormatter: ConsoleFormatter = (record) => [
  toLogObject(record),
];
