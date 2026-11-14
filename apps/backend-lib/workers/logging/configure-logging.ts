import { AsyncLocalStorage } from 'node:async_hooks';

import {
  type Config,
  configureSync,
  getConfig,
  getConsoleSink,
} from '@logtape/logtape';
import { redactByField, redactByPattern } from '@logtape/redaction';

import { isLogLevel, type LogLevel } from '../../core/logging/log-level.ts';
import { objectConsoleFormatter } from '../../core/logging/log-record.ts';
import {
  REDACTED,
  REDACTED_FIELD_PATTERNS,
  REDACTION_PATTERNS,
} from '../../core/logging/redaction.ts';

export interface LoggingOptions {
  readonly appName: 'api' | 'event';
  readonly level: LogLevel;
  readonly console?: Console;
}

interface AppliedLogging {
  readonly appName: LoggingOptions['appName'];
  readonly level: LogLevel;
  readonly console: Console;
  readonly config: Config<string, string>;
}

// 不正なLOG_LEVELは環境の検証で失敗させるため、ログ自体は既定のレベルで出し続ける
const FALLBACK_LEVEL: LogLevel = 'info';

const CONSOLE_SINK_ID = 'console';

// LogTapeのmetaロガーを設定しないと、伏せ字を通らない既定のコンソールシンクが付き、設定完了の通知(info)も出る。明示的に設定し、LogTape自身の警告以上だけを同じ伏せ字付きの出力先へ流す
const META_LOGGER_CATEGORY = ['logtape', 'meta'];
const META_LOGGER_LOWEST_LEVEL = 'warning';

let applied: AppliedLogging | undefined;
// 設定し直しても進行中の処理単位の文脈を失わないよう、isolateで1つのストアを使い続ける
let contextLocalStorage: AsyncLocalStorage<Record<string, unknown>> | undefined;

function isApplied(
  appName: LoggingOptions['appName'],
  level: LogLevel,
  output: Console,
): boolean {
  return (
    applied !== undefined &&
    applied.config === getConfig() &&
    applied.appName === appName &&
    applied.level === level &&
    applied.console === output
  );
}

export function ensureLoggingConfigured(options: LoggingOptions): void {
  const level = isLogLevel(options.level) ? options.level : FALLBACK_LEVEL;
  const output = options.console ?? console;
  if (isApplied(options.appName, level, output)) {
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
        { fieldPatterns: REDACTED_FIELD_PATTERNS, action: () => REDACTED },
      ),
    },
    loggers: [
      {
        category: [options.appName],
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
  applied = { appName: options.appName, level, console: output, config };
}
