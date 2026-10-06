import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TEST_FILE_PATTERNS } from '../../config/test-patterns.ts';
import { createPlaywrightConfig } from './playwright-config.ts';
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

const gitIgnoredEntries = (): string[] =>
  readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8')
    .split('\n')
    .map((line) => line.trim());

describe('createPlaywrightConfig', () => {
  test('プロジェクト構成が空なら、プロジェクトを1つも持たない', () => {
    expect(createPlaywrightConfig([], {}).projects).toStrictEqual([]);
  });

  test('対象ごとに、到達確認のセットアッププロジェクトとテストのプロジェクトをこの順に作る', () => {
    const projectNames = createPlaywrightConfig(
      [CLIENT_PLAN, ADMIN_PLAN],
      {},
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
      createPlaywrightConfig([ADMIN_PLAN], {}).projects ?? [];

    expect(setupProject).toStrictEqual({
      name: 'admin-reachability',
      testDir: 'e2e/support',
      testMatch: 'reachability.setup.ts',
      use: { baseURL: 'https://admin.staging.launch.example' },
    });
  });

  test('テストのプロジェクトは、到達確認に依存し、対象のディレクトリでE2Eの命名パターンに一致するファイルだけを実行する', () => {
    const [, testProject] =
      createPlaywrightConfig([CLIENT_PLAN], {}).projects ?? [];

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
      createPlaywrightConfig([CLIENT_PLAN], {}).projects ?? [];

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
    expect(createPlaywrightConfig([], SHARED_CHROMIUM).use).toStrictEqual({
      launchOptions: SHARED_CHROMIUM,
    });
  });

  test('共有Chromiumの指定が無ければ、空の起動オプションのままにする', () => {
    expect(createPlaywrightConfig([], {}).use).toStrictEqual({
      launchOptions: {},
    });
  });

  test('テスト成果物をtest-resultsへ出力する', () => {
    expect(createPlaywrightConfig([], {}).outputDir).toBe('test-results');
  });

  test('一覧表示と、自動で開かないHTMLレポートと、0件の通知を出力する', () => {
    expect(createPlaywrightConfig([], {}).reporter).toStrictEqual([
      ['list'],
      ['html', { outputFolder: 'playwright-report', open: 'never' }],
      ['./e2e/support/zero-tests-reporter.ts'],
    ]);
  });

  test('ファイルで指定するレポーターが、ルートからの相対パスに実在する', () => {
    const { reporter } = createPlaywrightConfig([], {});
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
});
