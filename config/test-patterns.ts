export type TestKind = 'unit' | 'browser' | 'worker' | 'e2e';

export const TEST_FILE_PATTERNS: Readonly<Record<TestKind, readonly string[]>> =
  {
    unit: ['**/*.unit.test.ts'],
    browser: ['**/*.browser.test.{ts,tsx}'],
    worker: ['**/*.worker.test.{ts,tsx}'],
    e2e: ['e2e/**/*.e2e.test.ts'],
  };

// BunとVitestが既定でテストファイルとみなす名前を漏れなく含む
export const TEST_LIKE_FILE_PATTERN: RegExp =
  /[._](?:test|spec)\.[cm]?[jt]sx?$/;

// 自動生成コードはこのどちらかの形で出力する契約とし、カバレッジ・静的解析・整形の対象から外す
export const GENERATED_CODE_PATTERNS: readonly string[] = [
  '**/*.gen.ts',
  '**/generated/**',
];

// ルートの単体テストが読み込んだアプリのソースは、各アプリの単体テストが網羅を確かめるため、ルートの実行の分母からだけ外す
export const ROOT_UNIT_COVERAGE_IGNORE_PATTERNS: readonly string[] = [
  'apps/**',
];

export const COVERAGE_THRESHOLD_PERCENT = 80 as const;
