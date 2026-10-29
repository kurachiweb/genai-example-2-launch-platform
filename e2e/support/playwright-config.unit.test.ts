import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TEST_FILE_PATTERNS } from '../../config/test-patterns.ts';
import {
  createPlaywrightConfig,
  DEFAULT_E2E_WORKERS,
  resolveE2EWorkers,
} from './playwright-config.ts';
import type { E2EProjectPlan } from './targets.ts';

const REPO_ROOT = join(import.meta.dirname, '..', '..');

const CLIENT_PLAN: E2EProjectPlan = {
  target: { name: 'client', baseURL: 'http://localhost:48044' },
  testDir: 'e2e/client',
  setupProjectName: 'client-reachability',
};

const ADMIN_PLAN: E2EProjectPlan = {
  target: { name: 'admin', baseURL: 'https://admin.staging.launch.example' },
  testDir: 'e2e/admin',
  setupProjectName: 'admin-reachability',
};

const SHARED_CHROMIUM = { executablePath: '/opt/chromium/chrome' };

const WORKERS = 2;

const gitIgnoredEntries = (): string[] =>
  readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8')
    .split('\n')
    .map((line) => line.trim());

describe('createPlaywrightConfig', () => {
  test('プロジェクト構成が空なら、プロジェクトを1つも持たない', () => {
    expect(createPlaywrightConfig([], {}, WORKERS).projects).toStrictEqual([]);
  });

  test('対象ごとに、到達確認のセットアッププロジェクトとテストのプロジェクトをこの順に作る', () => {
    const projectNames = createPlaywrightConfig(
      [CLIENT_PLAN, ADMIN_PLAN],
      {},
      WORKERS,
    ).projects?.map((project) => project.name);

    expect(projectNames).toStrictEqual([
      'client-reachability',
      'client',
      'admin-reachability',
      'admin',
    ]);
  });

  test('到達確認のセットアッププロジェクトは、対象のURLで到達確認のファイルだけを実行する', () => {
    const [setupProject] =
      createPlaywrightConfig([ADMIN_PLAN], {}, WORKERS).projects ?? [];

    expect(setupProject).toStrictEqual({
      name: 'admin-reachability',
      testDir: 'e2e/support',
      testMatch: 'reachability.setup.ts',
      use: { baseURL: 'https://admin.staging.launch.example' },
    });
  });

  test('テストのプロジェクトは、到達確認に依存し、対象のディレクトリでE2Eの命名パターンに一致するファイルだけを実行する', () => {
    const [, testProject] =
      createPlaywrightConfig([CLIENT_PLAN], {}, WORKERS).projects ?? [];

    expect(testProject).toStrictEqual({
      name: 'client',
      testDir: 'e2e/client',
      testMatch: [...TEST_FILE_PATTERNS.e2e],
      dependencies: ['client-reachability'],
      use: { baseURL: 'http://localhost:48044' },
    });
  });

  test('到達確認のセットアッププロジェクトが実行するファイルが、ルートからの相対パスに実在する', () => {
    const [setupProject] =
      createPlaywrightConfig([CLIENT_PLAN], {}, WORKERS).projects ?? [];

    expect(
      existsSync(
        join(
          REPO_ROOT,
          String(setupProject?.testDir),
          String(setupProject?.testMatch),
        ),
      ),
    ).toBe(true);
  });

  test('ブラウザは、受け取った起動オプションで起動する', () => {
    expect(
      createPlaywrightConfig([], SHARED_CHROMIUM, WORKERS).use,
    ).toStrictEqual({
      launchOptions: SHARED_CHROMIUM,
    });
  });

  test('共有Chromiumの指定が無ければ、空の起動オプションのままにする', () => {
    expect(createPlaywrightConfig([], {}, WORKERS).use).toStrictEqual({
      launchOptions: {},
    });
  });

  test('テスト成果物をtest-resultsへ出力する', () => {
    expect(createPlaywrightConfig([], {}, WORKERS).outputDir).toBe(
      'test-results',
    );
  });

  test('一覧表示と、自動で開かないHTMLレポートと、0件の通知を出力する', () => {
    expect(createPlaywrightConfig([], {}, WORKERS).reporter).toStrictEqual([
      ['list'],
      ['html', { outputFolder: 'playwright-report', open: 'never' }],
      ['./e2e/support/zero-tests-reporter.ts'],
    ]);
  });

  test('ファイルで指定するレポーターが、ルートからの相対パスに実在する', () => {
    const { reporter } = createPlaywrightConfig([], {}, WORKERS);
    const reporterPaths = (Array.isArray(reporter) ? reporter : [])
      .map(([name]) => name)
      .filter((name) => name.startsWith('./'));

    expect(reporterPaths).toStrictEqual([
      './e2e/support/zero-tests-reporter.ts',
    ]);
    expect(
      reporterPaths.every((path) => existsSync(join(REPO_ROOT, path))),
    ).toBe(true);
  });

  test.each(['test-results', 'playwright-report'])(
    '出力先の%sは、Git管理外である',
    (outputDir) => {
      expect(gitIgnoredEntries()).toContain(outputDir);
    },
  );

  test.each([1, 4])('並列数は、受け取った並列数(%d)にする', (workers) => {
    expect(createPlaywrightConfig([], {}, workers).workers).toBe(workers);
  });
});

describe('resolveE2EWorkers', () => {
  test('既定の並列数の上限は2である', () => {
    expect(DEFAULT_E2E_WORKERS).toBe(2);
  });

  test('E2E_WORKERSが未設定なら、既定の並列数の上限を返す', () => {
    expect(resolveE2EWorkers({})).toBe(DEFAULT_E2E_WORKERS);
  });

  test('E2E_WORKERSが空文字なら、未設定と同じく既定の並列数の上限を返す', () => {
    expect(resolveE2EWorkers({ E2E_WORKERS: '' })).toBe(DEFAULT_E2E_WORKERS);
  });

  test.each([
    ['1', 1],
    ['4', 4],
  ])('E2E_WORKERSが%sなら、その並列数を返す', (value, expected) => {
    expect(resolveE2EWorkers({ E2E_WORKERS: value })).toBe(expected);
  });

  test.each(['0', '-1', '1.5', '50%', 'abc'])(
    'E2E_WORKERSが%sなら、変数の名前と受け付ける形を示して失敗する',
    (value) => {
      expect(() => resolveE2EWorkers({ E2E_WORKERS: value })).toThrow(
        `環境変数E2E_WORKERSには1以上の整数を指定してください: ${value}`,
      );
    },
  );
});
