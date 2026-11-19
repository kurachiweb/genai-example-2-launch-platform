import { afterAll, describe, expect, test } from 'bun:test';

import { getConfig, getLogger, resetSync } from '@logtape/logtape';

import { REDACTED } from '../../core/logging/redaction.ts';

import {
  configuredAppName,
  ensureLoggingConfigured,
} from './configure-logging.ts';

const silentConsole = (): Console =>
  ({
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  }) as unknown as Console;

describe('ensureLoggingConfigured', () => {
  afterAll(() => {
    resetSync();
  });

  test('設定したアプリ名をconfiguredAppNameで返す', () => {
    ensureLoggingConfigured({
      appName: 'event',
      level: 'info',
      console: silentConsole(),
    });

    expect(configuredAppName()).toBe('event');
  });

  test('同じアプリ名・レベル・出力先なら設定し直さない', () => {
    const output = silentConsole();
    ensureLoggingConfigured({ appName: 'api', level: 'info', console: output });
    const first = getConfig();

    ensureLoggingConfigured({ appName: 'api', level: 'info', console: output });

    expect(getConfig()).toBe(first);
    expect(configuredAppName()).toBe('api');
  });

  test('アプリ名・レベル・出力先のどれかが変われば設定し直す', () => {
    const output = silentConsole();
    ensureLoggingConfigured({ appName: 'api', level: 'info', console: output });
    const initial = getConfig();

    ensureLoggingConfigured({
      appName: 'event',
      level: 'info',
      console: output,
    });
    const byAppName = getConfig();
    ensureLoggingConfigured({
      appName: 'event',
      level: 'debug',
      console: output,
    });
    const byLevel = getConfig();
    ensureLoggingConfigured({
      appName: 'event',
      level: 'debug',
      console: silentConsole(),
    });
    const byOutput = getConfig();

    expect(byAppName).not.toBe(initial);
    expect(byLevel).not.toBe(byAppName);
    expect(byOutput).not.toBe(byLevel);
    expect(configuredAppName()).toBe('event');
  });

  test('伏せる名前の項目を伏せ字にして出力する', () => {
    const lines: unknown[][] = [];
    const recorder = {
      ...silentConsole(),
      info: (...args: unknown[]) => {
        lines.push(args);
      },
    };
    ensureLoggingConfigured({
      appName: 'api',
      level: 'info',
      console: recorder,
    });

    getLogger(['api']).info('検査', { pepper: 'plain-value' });

    expect(JSON.stringify(lines)).toContain(REDACTED);
    expect(JSON.stringify(lines)).not.toContain('plain-value');
  });
});
