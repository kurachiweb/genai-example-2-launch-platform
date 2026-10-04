import { existsSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

import {
  APPS,
  type AppName,
  EXTERNAL_SOURCE_DIRS,
  QUALITY_GATE_EXCLUDED_DIRS,
  SHARED_DIRS,
} from '../../config/workspace-layout.ts';

export type StagedOwner =
  { readonly kind: 'root' } | { readonly kind: 'app'; readonly app: AppName };

export interface StagedTaskGroup {
  readonly owner: StagedOwner;
  readonly lintTargets: readonly string[];
}

export interface StagedTaskPlan {
  readonly lintGroups: readonly StagedTaskGroup[];
  readonly formatTargets: readonly string[];
}

export type PlanError =
  | {
      readonly kind: 'consumer-missing';
      readonly sharedDir: string;
      readonly consumer: AppName;
    }
  | {
      readonly kind: 'tooling-missing';
      readonly owner: StagedOwner;
      readonly hint: string;
    };

export type PlanResult =
  | { readonly ok: true; readonly plan: StagedTaskPlan }
  | { readonly ok: false; readonly errors: readonly PlanError[] };

export interface WorkspaceChecks {
  readonly isInstalled: (owner: StagedOwner) => boolean;
  readonly appExists: (app: AppName) => boolean;
}

interface SharedDirRemap {
  readonly source: string;
  readonly checker: AppName;
  readonly target: string;
}

interface LintAssignment {
  readonly owner: StagedOwner;
  readonly target: string;
  readonly remap?: SharedDirRemap;
}

const LOCK_FILE_NAME = 'bun.lock';
const LINT_TARGET_EXTENSIONS = ['.ts', '.tsx'];
const APPS_DIR = 'apps';
const EXCLUDED_DIRS = [...QUALITY_GATE_EXCLUDED_DIRS, ...EXTERNAL_SOURCE_DIRS];
const ROOT_OWNER: StagedOwner = { kind: 'root' };

const OWNERS_IN_ORDER: readonly StagedOwner[] = [
  ROOT_OWNER,
  ...APPS.map(({ name }): StagedOwner => ({ kind: 'app', app: name })),
];

const APPS_BY_LONGEST_DIR = APPS.toSorted(
  (a, b) => b.dir.length - a.dir.length,
);

// 共有ディレクトリは配置先のアプリの型設定と依存で検査する必要があるため、検査担当アプリの配置先パスへ読み替える
const SHARED_DIR_REMAPS: readonly SharedDirRemap[] = SHARED_DIRS.flatMap(
  ({ source, mounts, checkedBy }) =>
    mounts
      .filter(({ consumer }) => consumer === checkedBy)
      .map(({ consumer, target }) => ({ source, checker: consumer, target })),
);

const isUnder = (path: string, dir: string): boolean =>
  path.startsWith(`${dir}/`);

const isExcluded = (path: string): boolean =>
  basename(path) === LOCK_FILE_NAME ||
  EXCLUDED_DIRS.some((dir) => isUnder(path, dir));

const isLintTarget = (path: string): boolean =>
  LINT_TARGET_EXTENSIONS.some((extension) => path.endsWith(extension));

const isSameOwner = (a: StagedOwner, b: StagedOwner): boolean =>
  a.kind === 'root' ? b.kind === 'root' : b.kind === 'app' && a.app === b.app;

const appDirOf = (app: AppName): string => {
  const definition = APPS.find(({ name }) => name === app);
  if (definition === undefined) {
    throw new Error(`config/workspace-layout.tsのAPPSに${app}がありません。`);
  }
  return definition.dir;
};

const ownerDirOf = (owner: StagedOwner): string =>
  owner.kind === 'root' ? '' : appDirOf(owner.app);

const eslintBinOf = (owner: StagedOwner, repoRoot: string): string =>
  join(repoRoot, ownerDirOf(owner), 'node_modules', '.bin', 'eslint');

const installCommandOf = (dir: string, repoRoot: string): string =>
  `\`cd ${join(repoRoot, dir)} && bun install\``;

const installHintOf = (owner: StagedOwner, repoRoot: string): string => {
  const dir = ownerDirOf(owner);
  const label = dir === '' ? 'ルート' : dir;
  return `${label}に静的解析ツールが導入されていません。${installCommandOf(dir, repoRoot)}を実行してください。`;
};

const assignLintTarget = (path: string): readonly LintAssignment[] => {
  const remap = SHARED_DIR_REMAPS.find(({ source }) => isUnder(path, source));
  if (remap !== undefined) {
    const target = `${remap.target}${path.slice(remap.source.length)}`;
    return [{ owner: { kind: 'app', app: remap.checker }, target, remap }];
  }
  const app = APPS_BY_LONGEST_DIR.find(({ dir }) => isUnder(path, dir));
  if (app !== undefined) {
    return [{ owner: { kind: 'app', app: app.name }, target: path }];
  }
  // ルートの静的解析はapps配下を対象外にしており、ルートへ渡すと黙って検査されないため、未登録のアプリのファイルは静的解析の計画に含めない
  if (isUnder(path, APPS_DIR)) {
    return [];
  }
  return [{ owner: ROOT_OWNER, target: path }];
};

const groupByOwner = (
  assignments: readonly LintAssignment[],
): readonly StagedTaskGroup[] =>
  OWNERS_IN_ORDER.map((owner) => ({
    owner,
    lintTargets: assignments
      .filter((assignment) => isSameOwner(assignment.owner, owner))
      .map(({ target }) => target),
  })).filter(({ lintTargets }) => lintTargets.length > 0);

const findMissingConsumers = (
  assignments: readonly LintAssignment[],
  appExists: (app: AppName) => boolean,
): readonly SharedDirRemap[] =>
  SHARED_DIR_REMAPS.filter((remap) =>
    assignments.some((assignment) => assignment.remap === remap),
  ).filter(({ checker }) => !appExists(checker));

const findToolingErrors = (
  lintGroups: readonly StagedTaskGroup[],
  missingConsumers: readonly SharedDirRemap[],
  isInstalled: (owner: StagedOwner) => boolean,
  repoRoot: string,
): readonly PlanError[] =>
  lintGroups
    .filter(
      ({ owner }) =>
        !missingConsumers.some(({ checker }) =>
          isSameOwner(owner, { kind: 'app', app: checker }),
        ),
    )
    .filter(({ owner }) => !isInstalled(owner))
    .map(({ owner }) => ({
      kind: 'tooling-missing',
      owner,
      hint: installHintOf(owner, repoRoot),
    }));

export function planStagedTasks(
  stagedAbsolutePaths: readonly string[],
  repoRoot: string,
  isInstalled: (owner: StagedOwner) => boolean,
  appExists: (app: AppName) => boolean,
): PlanResult {
  const formatTargets = stagedAbsolutePaths
    .map((path) => relative(repoRoot, path))
    .filter((path) => !isExcluded(path));
  const assignments = formatTargets
    .filter(isLintTarget)
    .flatMap(assignLintTarget);
  const lintGroups = groupByOwner(assignments);
  const missingConsumers = findMissingConsumers(assignments, appExists);
  const errors: readonly PlanError[] = [
    ...missingConsumers.map(({ source, checker }): PlanError => ({
      kind: 'consumer-missing',
      sharedDir: source,
      consumer: checker,
    })),
    ...findToolingErrors(lintGroups, missingConsumers, isInstalled, repoRoot),
  ];
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, plan: { lintGroups, formatTargets } };
}

// lint-stagedはコマンド文字列をstring-argvで分割してシェルを介さずに実行する。string-argvは引用符で囲んだ範囲を1つの引数とし、エスケープは解釈しない
const quoteArgument = (argument: string): string => {
  if (/^[^\s'"]+$/.test(argument)) {
    return argument;
  }
  if (!argument.includes('"')) {
    return `"${argument}"`;
  }
  if (!argument.includes("'")) {
    return `'${argument}'`;
  }
  throw new Error(
    `シングルとダブルの引用符を両方含むパスはコミット前検査のコマンドへ渡せません。ファイル名を変更してください: ${argument}`,
  );
};

const toCommandLine = (
  bin: string,
  options: readonly string[],
  files: readonly string[],
  repoRoot: string,
): string =>
  [
    'bun',
    '--bun',
    quoteArgument(bin),
    ...options,
    ...files.map((file) => quoteArgument(join(repoRoot, file))),
  ].join(' ');

export function toCommands(
  plan: StagedTaskPlan,
  repoRoot: string,
): readonly string[] {
  const lintCommands = plan.lintGroups
    .filter(({ lintTargets }) => lintTargets.length > 0)
    .map(({ owner, lintTargets }) =>
      toCommandLine(
        eslintBinOf(owner, repoRoot),
        ['--fix', '--no-warn-ignored'],
        lintTargets,
        repoRoot,
      ),
    );
  const formatCommands =
    plan.formatTargets.length > 0
      ? [
          toCommandLine(
            join(repoRoot, 'node_modules', '.bin', 'prettier'),
            ['--write', '--ignore-unknown'],
            plan.formatTargets,
            repoRoot,
          ),
        ]
      : [];
  return [...lintCommands, ...formatCommands];
}

export function describePlanError(error: PlanError, repoRoot: string): string {
  if (error.kind === 'tooling-missing') {
    return error.hint;
  }
  const consumerDir = appDirOf(error.consumer);
  return `${error.sharedDir}のTypeScriptを検査するアプリ${consumerDir}がまだ作成されていません。${consumerDir}を作成し、${installCommandOf(consumerDir, repoRoot)}を実行してください。`;
}

export function createWorkspaceChecks(repoRoot: string): WorkspaceChecks {
  return {
    isInstalled: (owner) => existsSync(eslintBinOf(owner, repoRoot)),
    appExists: (app) =>
      existsSync(join(repoRoot, appDirOf(app), 'package.json')),
  };
}
