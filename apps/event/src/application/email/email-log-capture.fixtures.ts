import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

const records: LogRecord[] = [];

export function startLogCapture(): void {
  records.length = 0;
  configureSync({
    reset: true,
    sinks: {
      capture: (record) => {
        records.push(record);
      },
    },
    loggers: [
      { category: ['event'], sinks: ['capture'], lowestLevel: 'debug' },
      { category: ['logtape', 'meta'], sinks: [], lowestLevel: 'warning' },
    ],
  });
}

export function stopLogCapture(): void {
  resetSync();
}

export function clearCapturedLogs(): void {
  records.length = 0;
}

export function capturedLogsOf(category: readonly string[]): LogRecord[] {
  const expected = category.join('.');
  return records.filter((record) => record.category.join('.') === expected);
}
