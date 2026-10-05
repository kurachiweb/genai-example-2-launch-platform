import { readdirSync, statSync } from 'node:fs';
import { join, matchesGlob, relative } from 'node:path';

import { TEST_FILE_PATTERNS } from '../../config/test-patterns.ts';

export type E2ETargetName = 'client' | 'admin';

export interface E2ETarget {
  readonly name: E2ETargetName;
  readonly baseURL: string;
}

export interface E2EProjectPlan {
  readonly target: E2ETarget;
  readonly testDir: string;
  readonly setupProjectName: string;
}

interface E2ETargetDefinition {
  readonly name: E2ETargetName;
  readonly defaultBaseURL: string;
  readonly baseURLEnvKey: string;
}

const E2E_ROOT_DIR = 'e2e';

const REACHABILITY_SETUP_SUFFIX = 'reachability';

const E2E_TARGET_DEFINITIONS: readonly E2ETargetDefinition[] = [
  {
    name: 'client',
    defaultBaseURL: 'http://localhost:48044',
    baseURLEnvKey: 'E2E_CLIENT_URL',
  },
  {
    name: 'admin',
    defaultBaseURL: 'http://localhost:48045',
    baseURLEnvKey: 'E2E_ADMIN_URL',
  },
];

// 空文字を設定しても空のURLで実行されないよう、未設定と同じく既定のURLを使う
export function resolveE2ETargets(
  env: Readonly<Record<string, string | undefined>>,
): readonly E2ETarget[] {
  return E2E_TARGET_DEFINITIONS.map(
    ({ name, defaultBaseURL, baseURLEnvKey }) => ({
      name,
      baseURL: env[baseURLEnvKey] || defaultBaseURL,
    }),
  );
}

export function resolveE2EProjects(
  targets: readonly E2ETarget[],
  hasTestFiles: (testDir: string) => boolean,
): readonly E2EProjectPlan[] {
  return targets
    .map((target) => ({
      target,
      testDir: `${E2E_ROOT_DIR}/${target.name}`,
      setupProjectName: `${target.name}-${REACHABILITY_SETUP_SUFFIX}`,
    }))
    .filter((plan) => hasTestFiles(plan.testDir));
}

// playwright.config.tsはNode上でも読み込まれ得るため、Bun固有の`Bun.Glob`ではなく`node:path`で照合する
const matchesE2ETestPattern = (repoRelativePath: string): boolean =>
  TEST_FILE_PATTERNS.e2e.some((pattern) =>
    matchesGlob(repoRelativePath, pattern),
  );

// Playwrightと同じく、対象のパスが無いかディレクトリでなければテストは0件とみなす
export function createE2ETestFileDetector(
  rootDir: string,
): (testDir: string) => boolean {
  return (testDir) => {
    const absoluteTestDir = join(rootDir, testDir);
    if (!statSync(absoluteTestDir, { throwIfNoEntry: false })?.isDirectory()) {
      return false;
    }
    return readdirSync(absoluteTestDir, {
      recursive: true,
      withFileTypes: true,
    }).some(
      (entry) =>
        entry.isFile() &&
        matchesE2ETestPattern(
          relative(rootDir, join(entry.parentPath, entry.name)),
        ),
    );
  };
}
