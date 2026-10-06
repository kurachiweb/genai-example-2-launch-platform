import {
  COVERAGE_THRESHOLD_PERCENT,
  GENERATED_CODE_PATTERNS,
  TEST_FILE_PATTERNS,
  type TestKind,
} from '../test-patterns.ts';

// Vitestの設定型は変更可能な配列を要求するため、配列だけは変更可能な型にして各プリセットが自分のコピーを持つ
export interface CoveragePreset {
  readonly provider: 'v8' | 'istanbul';
  readonly reportsDirectory: string;
  readonly reporter: ('text' | 'lcov')[];
  readonly thresholds: {
    readonly lines: number;
    readonly functions: number;
    readonly perFile: true;
  };
  readonly exclude: string[];
}

export interface TestKindPreset {
  readonly include: string[];
  readonly passWithNoTests: true;
  readonly attachmentsDir: string;
  readonly coverage: CoveragePreset;
}

// Vitestの既定値と同じだが、Git管理外にする出力先として.gitignoreと突き合わせるため明示する
const ATTACHMENTS_DIR = '.vitest-attachments';

// アプリが指定するcoverage.includeは未読込のファイルも分母に含めるため、実行中の種別以外のテストファイルも明示的に外す
const COVERAGE_EXCLUDE_PATTERNS: readonly string[] = [
  ...Object.values(TEST_FILE_PATTERNS).flat(),
  ...GENERATED_CODE_PATTERNS,
];

export function createTestKindPreset(
  kind: Extract<TestKind, 'browser' | 'worker'>,
  provider: CoveragePreset['provider'],
): TestKindPreset {
  return {
    include: [...TEST_FILE_PATTERNS[kind]],
    passWithNoTests: true,
    attachmentsDir: ATTACHMENTS_DIR,
    coverage: {
      provider,
      reportsDirectory: `coverage/${kind}`,
      reporter: ['text', 'lcov'],
      // Bunの単体テストはファイル単位で閾値を判定するため、判定単位をそろえる
      thresholds: {
        lines: COVERAGE_THRESHOLD_PERCENT,
        functions: COVERAGE_THRESHOLD_PERCENT,
        perFile: true,
      },
      exclude: [...COVERAGE_EXCLUDE_PATTERNS],
    },
  };
}
