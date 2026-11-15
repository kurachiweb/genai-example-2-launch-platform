import { describe, expect, test } from 'bun:test';

import { currentExecutionSite } from './execution-site.ts';

describe('currentExecutionSite', () => {
  test('文書(document)を持たない大域の値ではサーバーで実行したとみなす', () => {
    expect(currentExecutionSite({})).toBe('server');
  });

  test('文書(document)を持つ大域の値ではブラウザで実行したとみなす', () => {
    expect(currentExecutionSite({ document: {} })).toBe('browser');
  });

  test('引数を省略すると実行中の大域の値を調べ、文書を持たないBunではサーバーとみなす', () => {
    expect(currentExecutionSite()).toBe('server');
  });
});
