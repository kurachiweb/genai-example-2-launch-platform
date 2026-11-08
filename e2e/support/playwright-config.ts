import type { PlaywrightTestConfig, Project } from '@playwright/test';

import { TEST_FILE_PATTERNS } from '../../config/test-patterns.ts';
import type { BrowserLaunchOptions } from '../../config/vitest/browser.ts';
import type { E2EProjectPlan, E2ETargetName } from './targets.ts';

// パスはいずれも、ルートに置くplaywright.config.tsのディレクトリを基準にPlaywrightが解決する
const OUTPUT_DIR = 'test-results';
const HTML_REPORT_DIR = 'playwright-report';
const REACHABILITY_SETUP_DIR = 'e2e/support';
const REACHABILITY_SETUP_FILE = 'reachability.setup.ts';
const ZERO_TESTS_REPORTER_PATH = './e2e/support/zero-tests-reporter.ts';

// 開発サーバーに対して多く並列に実行すると機械の負荷で実行環境が落ちることがあり、Playwrightの既定(CPUのコア数の半分)は機械によって変わるため、ローカルとCIで同じ上限にする
export const DEFAULT_E2E_WORKERS = 2;

const E2E_WORKERS_ENV_KEY = 'E2E_WORKERS';

const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;

export function resolveE2EWorkers(
  env: Readonly<Record<string, string | undefined>>,
): number {
  const value = env[E2E_WORKERS_ENV_KEY];
  if (value === undefined || value === '') {
    return DEFAULT_E2E_WORKERS;
  }
  if (!POSITIVE_INTEGER_PATTERN.test(value)) {
    throw new Error(
      `環境変数${E2E_WORKERS_ENV_KEY}には1以上の整数を指定してください: ${value}`,
    );
  }
  return Number.parseInt(value, 10);
}

// 管理者側のテストは、有効な最上位管理者が1人だけの状態を前提にする確認のために他の管理者のロールを一時的に変えるため、同じ対象のテストを並行させない
const PROJECT_WORKER_LIMITS: Readonly<Partial<Record<E2ETargetName, number>>> =
  Object.freeze({ admin: 1 });

// 直列の組の1つの手順。testMatchはその対象のディレクトリにあるE2Eテストのファイル名
export interface E2ESerialStep {
  readonly target: E2ETargetName;
  readonly testMatch: string;
}

// 同じ共有の行を書き換えるなどの理由で、手順の順に1つずつ実行するE2Eテストの組
export interface E2ESerialGroup {
  readonly name: string;
  readonly steps: readonly E2ESerialStep[];
}

interface SerialProjectsState {
  readonly projects: readonly Project[];
  readonly previousStepProjectName: string | undefined;
}

const workerLimitOf = (
  targetName: E2ETargetName,
): Readonly<Pick<Project, 'workers'>> => {
  const workers = PROJECT_WORKER_LIMITS[targetName];
  return workers === undefined ? {} : { workers };
};

const serialStepFilesOf = (
  serialGroups: readonly E2ESerialGroup[],
  targetName: E2ETargetName,
): readonly string[] =>
  serialGroups
    .flatMap((group) => group.steps)
    .filter((step) => step.target === targetName)
    .map((step) => step.testMatch);

// 直列の組の手順のファイルは組のプロジェクトだけが実行するよう、対象のテストのプロジェクトから外す
const toProjects = (
  { target, testDir, setupProjectName }: E2EProjectPlan,
  serialGroups: readonly E2ESerialGroup[],
): Project[] => {
  const testIgnore = serialStepFilesOf(serialGroups, target.name);
  return [
    {
      name: setupProjectName,
      testDir: REACHABILITY_SETUP_DIR,
      testMatch: REACHABILITY_SETUP_FILE,
      use: { baseURL: target.baseURL },
    },
    {
      name: target.name,
      testDir,
      testMatch: [...TEST_FILE_PATTERNS.e2e],
      ...(testIgnore.length === 0 ? {} : { testIgnore: [...testIgnore] }),
      dependencies: [setupProjectName],
      use: { baseURL: target.baseURL },
      ...workerLimitOf(target.name),
    },
  ];
};

const serialStepProjectName = (
  group: E2ESerialGroup,
  stepIndex: number,
  targetName: E2ETargetName,
): string => `${group.name}-${String(stepIndex + 1)}-${targetName}`;

// 並列数の上限は「同じ対象のテストを並行させない」ためのもので、別のプロジェクトに分けた手順は対象のプロジェクトの上限の外で動く。上限のある対象の手順は対象のテストのプロジェクトにも依存させ、対象のテストの後に動かして上限の意味を保つ
const serialStepDependenciesOf = (
  plan: E2EProjectPlan,
  previousStepProjectName: string | undefined,
): string[] => [
  plan.setupProjectName,
  ...(PROJECT_WORKER_LIMITS[plan.target.name] === undefined
    ? []
    : [plan.target.name]),
  ...(previousStepProjectName === undefined ? [] : [previousStepProjectName]),
];

// 手順ごとに、対象の到達確認と1つ前の有効な手順に依存するプロジェクトを作る。対象がプロジェクト構成に無い手順は作らず、順の番号は元の並びのまま次の手順を1つ前の有効な手順に繋ぐ
const toSerialGroupProjects = (
  group: E2ESerialGroup,
  plansByTarget: ReadonlyMap<E2ETargetName, E2EProjectPlan>,
): readonly Project[] =>
  group.steps.reduce<SerialProjectsState>(
    (state, step, stepIndex) => {
      const plan = plansByTarget.get(step.target);
      if (plan === undefined) {
        return state;
      }
      const name = serialStepProjectName(group, stepIndex, step.target);
      const project: Project = {
        name,
        testDir: plan.testDir,
        testMatch: step.testMatch,
        dependencies: serialStepDependenciesOf(
          plan,
          state.previousStepProjectName,
        ),
        use: { baseURL: plan.target.baseURL },
        ...workerLimitOf(step.target),
      };
      return {
        projects: [...state.projects, project],
        previousStepProjectName: name,
      };
    },
    { projects: [], previousStepProjectName: undefined },
  ).projects;

export function createPlaywrightConfig(
  plans: readonly E2EProjectPlan[],
  launchOptions: BrowserLaunchOptions,
  workers: number,
  serialGroups: readonly E2ESerialGroup[] = [],
): PlaywrightTestConfig {
  const plansByTarget = new Map(plans.map((plan) => [plan.target.name, plan]));
  return {
    outputDir: OUTPUT_DIR,
    workers,
    // 開発コンテナからはホストのブラウザを開けず、失敗時にレポートの配信サーバーが待ち続けてコマンドが終わらないため、自動で開かない
    reporter: [
      ['list'],
      ['html', { outputFolder: HTML_REPORT_DIR, open: 'never' }],
      [ZERO_TESTS_REPORTER_PATH],
    ],
    use: { launchOptions },
    projects: [
      ...plans.flatMap((plan) => toProjects(plan, serialGroups)),
      ...serialGroups.flatMap((group) =>
        toSerialGroupProjects(group, plansByTarget),
      ),
    ],
  };
}
