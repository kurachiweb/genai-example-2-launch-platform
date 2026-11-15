import { getConfig, resetSync, withContext } from '@logtape/logtape';
import { afterAll, describe, expect, test, vi } from 'vitest';

import { getAppLogger } from '../../core/logging/app-logger.ts';
import { REDACTED } from '../../core/logging/redaction.ts';
import {
  ensureLoggingConfigured,
  type LoggingOptions,
} from './configure-logging.ts';

type ConsoleMethod = 'trace' | 'debug' | 'info' | 'warn' | 'error';

interface ConsoleCall {
  readonly method: ConsoleMethod;
  readonly args: readonly unknown[];
}

interface RecordingConsole {
  readonly console: Console;
  readonly calls: ConsoleCall[];
}

function createRecordingConsole(): RecordingConsole {
  const calls: ConsoleCall[] = [];
  const record =
    (method: ConsoleMethod) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
    };
  const recorder = {
    trace: record('trace'),
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
  };
  return { console: recorder as unknown as Console, calls };
}

function configureWith(
  level: LoggingOptions['level'],
  recording: RecordingConsole = createRecordingConsole(),
): RecordingConsole {
  ensureLoggingConfigured({
    appName: 'api',
    level,
    console: recording.console,
  });
  return recording;
}

function loggedObjects(recording: RecordingConsole): unknown[] {
  return recording.calls.map(({ args }) => {
    expect(args).toHaveLength(1);
    return args[0];
  });
}

const logger = getAppLogger(['api', 'application', 'logging-test']);
const API_KEY = `lsk_${'AbCdEfGhIj'.repeat(4)}K_-`;
const EMAIL_ADDRESS = 'user@launch.example';
const TOKEN_VALUE = ['t', 'secret', 'value'].join('-');

afterAll(() => {
  resetSync();
});

describe('ensureLoggingConfigured', () => {
  test('処理単位の文脈の相関IDが非同期の処理をまたいでJSONオブジェクトに付く', async () => {
    const recording = configureWith('info');

    await withContext({ correlationId: 'correlation-1' }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      logger.info('処理しました', { status: 200 });
    });

    const [logged] = loggedObjects(recording) as [{ time: string }];
    const { time, ...rest } = logged;

    expect(recording.calls).toHaveLength(1);
    expect(time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect([rest]).toEqual([
      {
        level: 'info',
        category: 'api.application.logging-test',
        message: '処理しました',
        correlationId: 'correlation-1',
        status: 200,
      },
    ]);
    expect(recording.calls[0]?.method).toBe('info');
  });

  test('同時に進む処理単位はそれぞれの相関IDを持つ', async () => {
    const recording = configureWith('info');

    await Promise.all(
      ['correlation-a', 'correlation-b'].map((correlationId, index) =>
        withContext({ correlationId }, async () => {
          await new Promise((resolve) => setTimeout(resolve, 2 - index));
          logger.info('処理しました', { index });
        }),
      ),
    );

    expect(
      loggedObjects(recording)
        .map((object) => object as { correlationId: string; index: number })
        .map(({ correlationId, index }) => [index, correlationId])
        .toSorted(),
    ).toEqual([
      [0, 'correlation-a'],
      [1, 'correlation-b'],
    ]);
  });

  test('設定したレベルより低いログを出さない', () => {
    const recording = configureWith('warning');

    logger.debug('詳細');
    logger.info('情報');
    logger.warn('警告');
    logger.error('エラー');

    expect(recording.calls.map(({ method }) => method)).toEqual([
      'warn',
      'error',
    ]);
    expect(
      loggedObjects(recording).map(
        (object) => (object as { level: string }).level,
      ),
    ).toEqual(['warning', 'error']);
  });

  test('属性名と値の形式の両方で伏せ字にしたJSONオブジェクトを出す', () => {
    const recording = configureWith('info');

    logger.info('キー{key}で203.0.113.10から要求を受けました', {
      key: API_KEY,
      email: EMAIL_ADDRESS,
      token: TOKEN_VALUE,
      note: `連絡先は ${EMAIL_ADDRESS} です`,
      path: '/health',
    });

    expect(loggedObjects(recording)).toEqual([
      expect.objectContaining({
        message: `キー${REDACTED}で${REDACTED}から要求を受けました`,
        key: REDACTED,
        email: REDACTED,
        token: REDACTED,
        note: `連絡先は ${REDACTED} です`,
        path: '/health',
      }),
    ]);
    expect(JSON.stringify(recording.calls)).not.toContain(TOKEN_VALUE);
  });

  test('同じ設定での2回目以降の呼び出しでは設定し直さない', () => {
    const recording = configureWith('info');
    const first = getConfig();

    configureWith('info', recording);
    logger.info('1回だけ出る');

    expect(getConfig()).toBe(first);
    expect(recording.calls).toHaveLength(1);
  });

  test('ログレベルが変わったときだけ設定し直す', () => {
    const recording = configureWith('info');
    const infoConfig = getConfig();

    logger.debug('infoでは出ない');
    configureWith('debug', recording);
    const debugConfig = getConfig();
    logger.debug('debugでは出る');
    configureWith('debug', recording);

    expect(debugConfig).not.toBe(infoConfig);
    expect(getConfig()).toBe(debugConfig);
    expect(
      loggedObjects(recording).map(
        (object) => (object as { message: string }).message,
      ),
    ).toEqual(['debugでは出る']);
  });

  test('不正なログレベルはinfoとして設定する', () => {
    const recording = configureWith(
      'verbose' as unknown as LoggingOptions['level'],
    );
    const invalidConfig = getConfig();

    logger.debug('出ない');
    logger.info('出る');
    configureWith('info', recording);

    expect(
      loggedObjects(recording).map(
        (object) => (object as { message: string }).message,
      ),
    ).toEqual(['出る']);
    expect(getConfig()).toBe(invalidConfig);
  });

  test('出力先はコンソールだけで、LogTape自身の設定完了の通知を出さない', () => {
    const recording = configureWith('debug');

    const config = getConfig();

    expect(Object.keys(config?.sinks ?? {})).toHaveLength(1);
    expect(
      config?.loggers.flatMap((loggerConfig) => loggerConfig.sinks ?? []),
    ).toEqual(Object.keys(config?.sinks ?? {}).flatMap((id) => [id, id]));
    expect(recording.calls).toEqual([]);
  });

  test('アプリ名のカテゴリ以外のログは出さない', () => {
    const recording = configureWith('debug');

    getAppLogger(['event', 'application', 'logging-test']).error('別アプリ');

    expect(recording.calls).toEqual([]);
  });

  test('出力先を指定しなければグローバルのconsoleへJSONオブジェクトを出す', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      ensureLoggingConfigured({ appName: 'event', level: 'info' });
      getAppLogger(['event', 'application', 'logging-test']).info('既定の出力');

      expect(info).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          category: 'event.application.logging-test',
          message: '既定の出力',
        }),
      );
    } finally {
      info.mockRestore();
    }
  });

  test('処理単位の途中で設定し直しても、その後のログに相関IDが残る', async () => {
    const recording = configureWith('info');

    await withContext(
      { correlationId: 'correlation-reconfigured' },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        configureWith('debug', recording);
        await new Promise((resolve) => setTimeout(resolve, 1));
        logger.debug('設定し直した後のログ');
      },
    );

    expect(loggedObjects(recording)).toEqual([
      expect.objectContaining({
        level: 'debug',
        message: '設定し直した後のログ',
        correlationId: 'correlation-reconfigured',
      }),
    ]);
  });

  test('LogTapeの設定が外部で消された場合は設定し直す', () => {
    const recording = configureWith('info');

    resetSync();
    configureWith('info', recording);
    logger.info('設定し直した後に出る');

    expect(recording.calls).toHaveLength(1);
  });
});
