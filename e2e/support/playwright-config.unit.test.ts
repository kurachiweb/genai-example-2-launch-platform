import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TEST_FILE_PATTERNS } from '../../config/test-patterns.ts';
import {
  createPlaywrightConfig,
  DEFAULT_E2E_WORKERS,
  type E2ESerialGroup,
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

  test('管理者側のテストのプロジェクトは、並列数の上限を1にする', () => {
    const [, testProject] =
      createPlaywrightConfig([ADMIN_PLAN], {}, WORKERS).projects ?? [];

    expect(testProject).toStrictEqual({
      name: 'admin',
      testDir: 'e2e/admin',
      testMatch: [...TEST_FILE_PATTERNS.e2e],
      dependencies: ['admin-reachability'],
      use: { baseURL: 'https://admin.staging.launch.example' },
      workers: 1,
    });
  });

  test('到達確認のセットアッププロジェクトには、並列数の上限を付けない', () => {
    const [setupProject] =
      createPlaywrightConfig([ADMIN_PLAN], {}, WORKERS).projects ?? [];

    expect(setupProject).not.toHaveProperty('workers');
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

describe('createPlaywrightConfig(直列の組)', () => {
  const BOTH_TARGETS_GROUP: E2ESerialGroup = {
    name: 'shared-row',
    steps: [
      { target: 'client', testMatch: 'first.e2e.test.ts' },
      { target: 'admin', testMatch: 'second.e2e.test.ts' },
    ],
  };

  const CLIENT_ONLY_GROUP: E2ESerialGroup = {
    name: 'client-only',
    steps: [{ target: 'client', testMatch: 'only.e2e.test.ts' }],
  };

  const projectNamesOf = (
    plans: readonly E2EProjectPlan[],
    serialGroups: readonly E2ESerialGroup[],
  ): (string | undefined)[] | undefined =>
    createPlaywrightConfig(plans, {}, WORKERS, serialGroups).projects?.map(
      (project) => project.name,
    );

  const projectNamed = (
    plans: readonly E2EProjectPlan[],
    serialGroups: readonly E2ESerialGroup[],
    name: string,
  ) =>
    createPlaywrightConfig(plans, {}, WORKERS, serialGroups).projects?.find(
      (project) => project.name === name,
    );

  test('直列の組を空で渡すと、省いたときと同じ構成になる', () => {
    expect(
      createPlaywrightConfig([CLIENT_PLAN, ADMIN_PLAN], {}, WORKERS, []),
    ).toStrictEqual(
      createPlaywrightConfig([CLIENT_PLAN, ADMIN_PLAN], {}, WORKERS),
    );
  });

  test('直列の組の手順のファイルは、その対象のテストのプロジェクトのtestIgnoreに入る', () => {
    const plans = [CLIENT_PLAN, ADMIN_PLAN];

    expect(
      projectNamed(plans, [BOTH_TARGETS_GROUP], 'client')?.testIgnore,
    ).toStrictEqual(['first.e2e.test.ts']);
    expect(
      projectNamed(plans, [BOTH_TARGETS_GROUP], 'admin')?.testIgnore,
    ).toStrictEqual(['second.e2e.test.ts']);
  });

  test('複数の直列の組が同じ対象の手順を持てば、その対象のテストのプロジェクトのtestIgnoreにすべて入る', () => {
    expect(
      projectNamed(
        [CLIENT_PLAN, ADMIN_PLAN],
        [BOTH_TARGETS_GROUP, CLIENT_ONLY_GROUP],
        'client',
      )?.testIgnore,
    ).toStrictEqual(['first.e2e.test.ts', 'only.e2e.test.ts']);
  });

  test('直列の組の手順が無い対象のテストのプロジェクトには、testIgnoreを付けない', () => {
    expect(
      projectNamed([CLIENT_PLAN, ADMIN_PLAN], [CLIENT_ONLY_GROUP], 'admin'),
    ).not.toHaveProperty('testIgnore');
  });

  test('直列の組の手順ごとに、対象ごとのプロジェクトの後に<組の名前>-<順>-<対象名>のプロジェクトを組の順に並べる', () => {
    expect(
      projectNamesOf(
        [CLIENT_PLAN, ADMIN_PLAN],
        [BOTH_TARGETS_GROUP, CLIENT_ONLY_GROUP],
      ),
    ).toStrictEqual([
      'client-reachability',
      'client',
      'admin-reachability',
      'admin',
      'shared-row-1-client',
      'shared-row-2-admin',
      'client-only-1-client',
    ]);
  });

  test('直列の組の最初の手順のプロジェクトは、対象のディレクトリとURLで手順のファイルだけを実行し、対象の到達確認にだけ依存する', () => {
    expect(
      projectNamed(
        [CLIENT_PLAN, ADMIN_PLAN],
        [BOTH_TARGETS_GROUP],
        'shared-row-1-client',
      ),
    ).toStrictEqual({
      name: 'shared-row-1-client',
      testDir: 'e2e/client',
      testMatch: 'first.e2e.test.ts',
      dependencies: ['client-reachability'],
      use: { baseURL: 'http://localhost:48044' },
    });
  });

  test('直列の組の2つ目以降の手順のプロジェクトは、対象の到達確認と1つ前の手順に依存し、並列数の上限のある対象ではその対象のテストのプロジェクトにも依存して上限を引き継ぐ', () => {
    expect(
      projectNamed(
        [CLIENT_PLAN, ADMIN_PLAN],
        [BOTH_TARGETS_GROUP],
        'shared-row-2-admin',
      ),
    ).toStrictEqual({
      name: 'shared-row-2-admin',
      testDir: 'e2e/admin',
      testMatch: 'second.e2e.test.ts',
      dependencies: ['admin-reachability', 'admin', 'shared-row-1-client'],
      use: { baseURL: 'https://admin.staging.launch.example' },
      workers: 1,
    });
  });

  test('並列数の上限のある対象の手順のプロジェクトは、最初の手順でもその対象のテストのプロジェクトに依存する', () => {
    const adminFirstGroup: E2ESerialGroup = {
      name: 'admin-first',
      steps: [{ target: 'admin', testMatch: 'only.e2e.test.ts' }],
    };

    expect(
      projectNamed(
        [CLIENT_PLAN, ADMIN_PLAN],
        [adminFirstGroup],
        'admin-first-1-admin',
      )?.dependencies,
    ).toStrictEqual(['admin-reachability', 'admin']);
  });

  test('並列数の上限の無い対象の手順のプロジェクトは、2つ目以降でもその対象のテストのプロジェクトに依存しない', () => {
    const clientTwiceGroup: E2ESerialGroup = {
      name: 'client-twice',
      steps: [
        { target: 'client', testMatch: 'first.e2e.test.ts' },
        { target: 'client', testMatch: 'second.e2e.test.ts' },
      ],
    };

    expect(
      projectNamed(
        [CLIENT_PLAN, ADMIN_PLAN],
        [clientTwiceGroup],
        'client-twice-2-client',
      )?.dependencies,
    ).toStrictEqual(['client-reachability', 'client-twice-1-client']);
  });

  test('対象がプロジェクト構成に無い手順はプロジェクトを作らず、順を保ったまま次の手順を1つ前の有効な手順に繋ぐ', () => {
    const group: E2ESerialGroup = {
      name: 'shared-row',
      steps: [
        { target: 'client', testMatch: 'first.e2e.test.ts' },
        { target: 'admin', testMatch: 'second.e2e.test.ts' },
        { target: 'client', testMatch: 'third.e2e.test.ts' },
      ],
    };

    expect(projectNamesOf([CLIENT_PLAN], [group])).toStrictEqual([
      'client-reachability',
      'client',
      'shared-row-1-client',
      'shared-row-3-client',
    ]);
    expect(
      projectNamed([CLIENT_PLAN], [group], 'shared-row-3-client')?.dependencies,
    ).toStrictEqual(['client-reachability', 'shared-row-1-client']);
    expect(
      projectNamed([CLIENT_PLAN], [group], 'client')?.testIgnore,
    ).toStrictEqual(['first.e2e.test.ts', 'third.e2e.test.ts']);
  });

  test('すべての手順の対象がプロジェクト構成に無い直列の組は、プロジェクトを作らず、対象のテストのプロジェクトにtestIgnoreも付けない', () => {
    const adminOnlyGroup: E2ESerialGroup = {
      name: 'admin-only',
      steps: [{ target: 'admin', testMatch: 'only.e2e.test.ts' }],
    };

    expect(projectNamesOf([CLIENT_PLAN], [adminOnlyGroup])).toStrictEqual([
      'client-reachability',
      'client',
    ]);
    expect(
      projectNamed([CLIENT_PLAN], [adminOnlyGroup], 'client'),
    ).not.toHaveProperty('testIgnore');
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
