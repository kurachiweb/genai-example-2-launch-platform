import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  test,
} from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, matchesGlob } from 'node:path';

import { TEST_FILE_PATTERNS } from '../../config/test-patterns.ts';
import {
  createE2ETestFileDetector,
  type E2EProjectPlan,
  type E2ETarget,
  resolveE2EProjects,
  resolveE2ETargets,
} from './targets.ts';

const DEFAULT_CLIENT_URL = 'http://localhost:48044';
const DEFAULT_ADMIN_URL = 'http://localhost:48045';

const CLIENT_TARGET: E2ETarget = {
  name: 'client',
  baseURL: DEFAULT_CLIENT_URL,
};
const ADMIN_TARGET: E2ETarget = { name: 'admin', baseURL: DEFAULT_ADMIN_URL };

const matchesE2EPattern = (repoRelativePath: string): boolean =>
  TEST_FILE_PATTERNS.e2e.some((pattern) =>
    matchesGlob(repoRelativePath, pattern),
  );

describe('resolveE2ETargets', () => {
  test('環境変数が無ければ、利用者側と管理者側を既定のURLで、この順に返す', () => {
    expect(resolveE2ETargets({})).toStrictEqual([CLIENT_TARGET, ADMIN_TARGET]);
  });

  test('利用者側のURLを環境変数で上書きでき、管理者側は既定値のままになる', () => {
    expect(
      resolveE2ETargets({ E2E_CLIENT_URL: 'https://staging.launch.example' }),
    ).toStrictEqual([
      { name: 'client', baseURL: 'https://staging.launch.example' },
      ADMIN_TARGET,
    ]);
  });

  test('管理者側のURLを環境変数で上書きでき、利用者側は既定値のままになる', () => {
    expect(
      resolveE2ETargets({
        E2E_ADMIN_URL: 'https://admin.staging.launch.example',
      }),
    ).toStrictEqual([
      CLIENT_TARGET,
      { name: 'admin', baseURL: 'https://admin.staging.launch.example' },
    ]);
  });

  test('両方のURLを環境変数で同時に上書きできる', () => {
    expect(
      resolveE2ETargets({
        E2E_CLIENT_URL: 'http://127.0.0.1:3000',
        E2E_ADMIN_URL: 'http://127.0.0.1:3001',
      }),
    ).toStrictEqual([
      { name: 'client', baseURL: 'http://127.0.0.1:3000' },
      { name: 'admin', baseURL: 'http://127.0.0.1:3001' },
    ]);
  });

  test.each([
    [
      '値がundefinedである',
      { E2E_CLIENT_URL: undefined, E2E_ADMIN_URL: undefined },
    ],
    ['空文字列である', { E2E_CLIENT_URL: '', E2E_ADMIN_URL: '' }],
  ])('環境変数の%s場合は既定のURLを使う', (_label, env) => {
    expect(resolveE2ETargets(env)).toStrictEqual([CLIENT_TARGET, ADMIN_TARGET]);
  });

  test('対象のURL以外の環境変数はURLに影響しない', () => {
    expect(
      resolveE2ETargets({
        BASE_URL: 'http://other.example',
        CLIENT_URL: 'http://other.example',
        E2E_API_URL: 'http://other.example',
      }),
    ).toStrictEqual([CLIENT_TARGET, ADMIN_TARGET]);
  });

  test('型は環境変数から対象アプリの一覧を返す関数である', () => {
    expectTypeOf(resolveE2ETargets).toEqualTypeOf<
      (
        env: Readonly<Record<string, string | undefined>>,
      ) => readonly E2ETarget[]
    >();
  });
});

describe('resolveE2EProjects', () => {
  test('全対象にテストがあれば、対象ごとのディレクトリと到達確認のセットアップを持つプロジェクトを対象の順に返す', () => {
    expect(
      resolveE2EProjects([CLIENT_TARGET, ADMIN_TARGET], () => true),
    ).toStrictEqual([
      {
        target: CLIENT_TARGET,
        testDir: 'e2e/client',
        setupProjectName: 'client-reachability',
      },
      {
        target: ADMIN_TARGET,
        testDir: 'e2e/admin',
        setupProjectName: 'admin-reachability',
      },
    ]);
  });

  test('テストの無い対象はプロジェクトに含まれない', () => {
    const plans = resolveE2EProjects(
      [CLIENT_TARGET, ADMIN_TARGET],
      (testDir) => testDir === 'e2e/admin',
    );

    expect(plans.map((plan) => plan.target.name)).toEqual(['admin']);
  });

  test('どの対象にもテストが無ければプロジェクトは0件になる', () => {
    expect(
      resolveE2EProjects([CLIENT_TARGET, ADMIN_TARGET], () => false),
    ).toStrictEqual([]);
  });

  test('対象ごとのディレクトリを1回ずつ渡してテストの有無を問い合わせる', () => {
    const askedDirs: string[] = [];

    resolveE2EProjects([CLIENT_TARGET, ADMIN_TARGET], (testDir) => {
      askedDirs.push(testDir);
      return false;
    });

    expect(askedDirs).toEqual(['e2e/client', 'e2e/admin']);
  });

  test('環境変数で上書きしたURLがプロジェクトの対象にそのまま引き継がれる', () => {
    const targets = resolveE2ETargets({
      E2E_CLIENT_URL: 'https://staging.launch.example',
    });

    const [plan] = resolveE2EProjects(targets, () => true);

    expect(plan?.target).toStrictEqual({
      name: 'client',
      baseURL: 'https://staging.launch.example',
    });
  });

  test('対象ごとのディレクトリに置いたテストはE2Eの命名パターンに一致する', () => {
    const plans = resolveE2EProjects([CLIENT_TARGET, ADMIN_TARGET], () => true);

    for (const plan of plans) {
      expect(matchesE2EPattern(`${plan.testDir}/sample.e2e.test.ts`)).toBe(
        true,
      );
      expect(
        matchesE2EPattern(`${plan.testDir}/flows/sample.e2e.test.ts`),
      ).toBe(true);
    }
  });

  test('プロジェクト名と到達確認のセットアップのプロジェクト名はすべて異なる', () => {
    const plans = resolveE2EProjects([CLIENT_TARGET, ADMIN_TARGET], () => true);
    const projectNames = plans.flatMap((plan) => [
      plan.target.name,
      plan.setupProjectName,
    ]);

    expect(new Set(projectNames).size).toBe(projectNames.length);
  });

  test('受け取った対象の一覧を変更しない', () => {
    const targets = Object.freeze([
      Object.freeze({ ...CLIENT_TARGET }),
      Object.freeze({ ...ADMIN_TARGET }),
    ]);

    expect(() => resolveE2EProjects(targets, () => true)).not.toThrow();
    expect(targets).toStrictEqual([CLIENT_TARGET, ADMIN_TARGET]);
  });

  test('型は対象とテストの有無の判定からプロジェクト構成を返す関数である', () => {
    expectTypeOf(resolveE2EProjects).toEqualTypeOf<
      (
        targets: readonly E2ETarget[],
        hasTestFiles: (testDir: string) => boolean,
      ) => readonly E2EProjectPlan[]
    >();
  });
});

describe('createE2ETestFileDetector', () => {
  let rootDir: string;

  const writeFixtureFile = async (repoRelativePath: string): Promise<void> => {
    const absolutePath = join(rootDir, repoRelativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, '');
  };

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'e2e-targets-test-'));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test('対象のディレクトリが無ければテストは無いと判定する', () => {
    const hasTestFiles = createE2ETestFileDetector(rootDir);

    expect(hasTestFiles('e2e/client')).toBe(false);
  });

  test('対象のパスがディレクトリでなければテストは無いと判定する', async () => {
    await writeFixtureFile('e2e/client');
    const hasTestFiles = createE2ETestFileDetector(rootDir);

    expect(hasTestFiles('e2e/client')).toBe(false);
  });

  test('E2Eの命名に一致しないファイルしか無ければテストは無いと判定する', async () => {
    await writeFixtureFile('e2e/client/helpers.ts');
    await writeFixtureFile('e2e/client/login.test.ts');
    await writeFixtureFile('e2e/client/login.spec.ts');
    await writeFixtureFile('e2e/client/format.unit.test.ts');
    await writeFixtureFile('e2e/client/reachability.setup.ts');
    const hasTestFiles = createE2ETestFileDetector(rootDir);

    expect(hasTestFiles('e2e/client')).toBe(false);
  });

  test('E2Eの命名に一致する名前のディレクトリしか無ければテストは無いと判定する', async () => {
    await mkdir(join(rootDir, 'e2e/client/login.e2e.test.ts'), {
      recursive: true,
    });
    const hasTestFiles = createE2ETestFileDetector(rootDir);

    expect(hasTestFiles('e2e/client')).toBe(false);
  });

  test('対象のディレクトリ直下にE2Eテストが1つあればテストがあると判定する', async () => {
    await writeFixtureFile('e2e/client/login.e2e.test.ts');
    const hasTestFiles = createE2ETestFileDetector(rootDir);

    expect(hasTestFiles('e2e/client')).toBe(true);
  });

  test('対象のディレクトリの入れ子のディレクトリにあるE2Eテストも数える', async () => {
    await writeFixtureFile('e2e/client/flows/auth/login.e2e.test.ts');
    const hasTestFiles = createE2ETestFileDetector(rootDir);

    expect(hasTestFiles('e2e/client')).toBe(true);
  });

  test('ほかの対象のディレクトリにあるE2Eテストは数えない', async () => {
    await writeFixtureFile('e2e/admin/login.e2e.test.ts');
    await writeFixtureFile('e2e/support/sample.e2e.test.ts');
    const hasTestFiles = createE2ETestFileDetector(rootDir);

    expect(hasTestFiles('e2e/client')).toBe(false);
    expect(hasTestFiles('e2e/admin')).toBe(true);
  });

  test('実際のファイル配置から、テストのある対象だけがプロジェクトになる', async () => {
    await writeFixtureFile('e2e/client/helpers.ts');
    await writeFixtureFile('e2e/admin/dashboard.e2e.test.ts');

    const plans = resolveE2EProjects(
      resolveE2ETargets({}),
      createE2ETestFileDetector(rootDir),
    );

    expect(plans).toStrictEqual([
      {
        target: ADMIN_TARGET,
        testDir: 'e2e/admin',
        setupProjectName: 'admin-reachability',
      },
    ]);
  });
});
