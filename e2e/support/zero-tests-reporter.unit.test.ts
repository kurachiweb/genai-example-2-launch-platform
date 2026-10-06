import { describe, expect, spyOn, test } from 'bun:test';

import type { FullConfig, TestCase } from '@playwright/test/reporter';

import ZeroTestsReporter from './zero-tests-reporter.ts';

const ZERO_TESTS_NOTICE = '実行対象のE2Eテストは0件です\n';

const createOutput = (): {
  written: string[];
  write: (text: string) => void;
} => {
  const written: string[] = [];
  return { written, write: (text) => written.push(text) };
};

const config = {} as FullConfig;
const testCase = {} as TestCase;

describe('ZeroTestsReporter', () => {
  test('実行対象のテストが0件なら、0件であることを表示する', () => {
    const output = createOutput();
    const reporter = new ZeroTestsReporter({ output });

    reporter.onBegin(config, { allTests: () => [] });

    expect(output.written).toStrictEqual([ZERO_TESTS_NOTICE]);
  });

  test('実行対象のテストが1件以上あれば、何も表示しない', () => {
    const output = createOutput();
    const reporter = new ZeroTestsReporter({ output });

    reporter.onBegin(config, { allTests: () => [testCase, testCase] });

    expect(output.written).toStrictEqual([]);
  });

  test('Playwrightが渡すレポーターの設定には出力先が無いため、標準出力へ表示する', () => {
    const stdoutWrite = spyOn(process.stdout, 'write').mockImplementation(
      () => true,
    );
    try {
      const playwrightReporterOptions = { configDir: '/repo', _mode: 'test' };
      const reporter = new ZeroTestsReporter(playwrightReporterOptions);

      reporter.onBegin(config, { allTests: () => [] });

      expect(stdoutWrite).toHaveBeenCalledWith(ZERO_TESTS_NOTICE);
    } finally {
      stdoutWrite.mockRestore();
    }
  });
});
