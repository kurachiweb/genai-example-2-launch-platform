import { resolve } from 'node:path';

import type { CommandSpec } from '../../adapters/command-runner.ts';
import type { RepoFiles } from '../../adapters/repo-files.ts';
import {
  installCandidates,
  packageJsonOf,
  resolveInstallTargets,
  ROOT_TARGET,
} from '../../core/install-targets.ts';
import type { DeliveryDeps } from './delivery-command.ts';

export async function findInstallTargets(
  files: RepoFiles,
): Promise<readonly string[]> {
  const packageJsons = installCandidates().map(packageJsonOf);
  const exists = await Promise.all(
    packageJsons.map((path) => files.exists(path)),
  );
  return resolveInstallTargets(
    new Set(packageJsons.filter((_, index) => exists[index])),
  );
}

export const targetLabelOf = (dir: string): string =>
  dir === ROOT_TARGET ? 'ルート' : dir;

export interface TargetStep {
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

export const BUN = 'bun';

export const stepLineOf = ({ args }: TargetStep): string =>
  [BUN, ...args].join(' ');

// 子プロセスの出力が混ざらないよう、対象ごとに1つずつ順に実行する
export async function runInTarget(
  dir: string,
  step: TargetStep,
  { runner, repoRoot, stdout }: DeliveryDeps,
): Promise<number> {
  stdout.write(`$ (${targetLabelOf(dir)}) ${stepLineOf(step)}\n`);
  const spec: CommandSpec = {
    command: BUN,
    args: step.args,
    cwd: resolve(repoRoot, dir),
    ...(step.env === undefined ? {} : { env: step.env }),
    output: 'inherit',
  };
  const { code } = await runner.run(spec);
  return code;
}
