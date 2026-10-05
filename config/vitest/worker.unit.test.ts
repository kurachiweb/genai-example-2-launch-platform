import { describe, expect, expectTypeOf, test } from 'bun:test';

import {
  COVERAGE_THRESHOLD_PERCENT,
  GENERATED_CODE_PATTERNS,
  TEST_FILE_PATTERNS,
} from '../test-patterns.ts';
import type { TestKindPreset } from './test-kind-preset.ts';
import { workerTestPreset } from './worker.ts';

describe('workerTestPreset', () => {
  test('単一定義に基づく設定値だけを持ち、余計な設定を持たない', () => {
    expect(workerTestPreset).toStrictEqual({
      include: [...TEST_FILE_PATTERNS.worker],
      passWithNoTests: true,
      coverage: {
        provider: 'istanbul',
        reportsDirectory: 'coverage/worker',
        reporter: ['text', 'lcov'],
        thresholds: {
          lines: COVERAGE_THRESHOLD_PERCENT,
          functions: COVERAGE_THRESHOLD_PERCENT,
          perFile: true,
        },
        exclude: [
          ...Object.values(TEST_FILE_PATTERNS).flat(),
          ...GENERATED_CODE_PATTERNS,
        ],
      },
    });
  });

  test('Workers統合テストの命名パターンだけを対象にする', () => {
    expect(workerTestPreset.include).toEqual([...TEST_FILE_PATTERNS.worker]);
  });

  test('Istanbulでカバレッジを計測する', () => {
    expect(workerTestPreset.coverage.provider).toBe('istanbul');
  });

  test('lcovをWorkers統合テスト用の出力先へ書き出す', () => {
    expect(workerTestPreset.coverage.reportsDirectory).toBe('coverage/worker');
    expect(workerTestPreset.coverage.reporter).toEqual(['text', 'lcov']);
  });

  test('型はテスト種別の共通設定値である', () => {
    expectTypeOf(workerTestPreset).toEqualTypeOf<TestKindPreset>();
  });
});
