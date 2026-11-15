export const INFRA_DIR = 'apps/infra';
export const INFRA_ROOT_MODULE_DIR = `${INFRA_DIR}/live`;

const MODULE_DIR_PATTERN = `${INFRA_DIR}/modules/*`;
const SEARCHED_DIRS: readonly string[] = [
  INFRA_ROOT_MODULE_DIR,
  MODULE_DIR_PATTERN,
];

// 取得したプロバイダやモジュールを置く`.terraform`の中を拾わないよう、各ディレクトリの直下とOpenTofuが既定で読むテストのディレクトリ`tests`だけを探す
export const INFRA_CONFIG_PATTERNS: readonly string[] = SEARCHED_DIRS.map(
  (dir) => `${dir}/*.tf`,
);
export const INFRA_TEST_PATTERNS: readonly string[] = SEARCHED_DIRS.flatMap(
  (dir) => [`${dir}/*.tftest.hcl`, `${dir}/tests/*.tftest.hcl`],
);

const TOFU = 'tofu';

export interface InfraCheckStep {
  readonly command: string;
  readonly args: readonly string[];
}

export interface InfraFiles {
  readonly configFiles: readonly string[];
  readonly testFiles: readonly string[];
}

const dirOf = (path: string): string => path.slice(0, path.lastIndexOf('/'));

const moduleDirsOf = (configFiles: readonly string[]): readonly string[] => {
  const dirs = [...new Set(configFiles.map(dirOf))];
  if (!dirs.includes(INFRA_ROOT_MODULE_DIR)) {
    throw new Error(
      `ルートモジュール(${INFRA_ROOT_MODULE_DIR})の定義が見つかりません。`,
    );
  }
  return [
    INFRA_ROOT_MODULE_DIR,
    ...dirs.filter((dir) => dir !== INFRA_ROOT_MODULE_DIR).toSorted(),
  ];
};

const hasTests = (dir: string, testFiles: readonly string[]): boolean =>
  testFiles.some((path) => {
    const parent = dirOf(path);
    return parent === dir || parent === `${dir}/tests`;
  });

const tofu = (...args: readonly string[]): InfraCheckStep => ({
  command: TOFU,
  args,
});

const stepsForDir = (
  dir: string,
  testFiles: readonly string[],
): readonly InfraCheckStep[] => {
  const chdir = `-chdir=${dir}`;
  return [
    tofu(chdir, 'init', '-backend=false', '-lockfile=readonly', '-input=false'),
    tofu(chdir, 'validate'),
    ...(hasTests(dir, testFiles) ? [tofu(chdir, 'test')] : []),
  ];
};

export function planInfraCheck({
  configFiles,
  testFiles,
}: InfraFiles): readonly InfraCheckStep[] {
  return [
    tofu('fmt', '-check', '-recursive', INFRA_DIR),
    ...moduleDirsOf(configFiles).flatMap((dir) => stepsForDir(dir, testFiles)),
  ];
}
