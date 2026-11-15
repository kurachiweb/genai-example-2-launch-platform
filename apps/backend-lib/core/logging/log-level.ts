// LogTapeのレベルのうち、環境変数`LOG_LEVEL`で指定できるもの
export const LOG_LEVELS = ['debug', 'info', 'warning', 'error'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

const LOG_LEVEL_SET: ReadonlySet<string> = new Set(LOG_LEVELS);

export function isLogLevel(level: string): level is LogLevel {
  return LOG_LEVEL_SET.has(level);
}
