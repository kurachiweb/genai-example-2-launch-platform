import { describe, expect, test } from 'bun:test';

import { isLogLevel, LOG_LEVELS } from './log-level.ts';

describe('LOG_LEVELS', () => {
  test('環境変数で指定できるログレベルを低い順に並べる', () => {
    expect(LOG_LEVELS).toEqual(['debug', 'info', 'warning', 'error']);
  });
});

describe('isLogLevel', () => {
  test.each(['debug', 'info', 'warning', 'error'])(
    '%sをログレベルとして受け付ける',
    (level) => {
      expect(isLogLevel(level)).toBe(true);
    },
  );

  test.each(['verbose', 'trace', 'fatal', 'INFO', ''])(
    '%pはログレベルとして受け付けない',
    (level) => {
      expect(isLogLevel(level)).toBe(false);
    },
  );
});
