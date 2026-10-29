import {
  createCommandRunner,
  type TextOutput,
} from '../../adapters/command-runner.ts';
import { createGithubActionsIo } from '../../adapters/github-actions.ts';
import { createRepoFiles } from '../../adapters/repo-files.ts';
import type { DeliveryDeps } from './delivery-command.ts';

export interface DefaultDepsOptions {
  readonly repoRoot: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdout: TextOutput;
  readonly stderr: TextOutput;
}

export function createDefaultDeps({
  repoRoot,
  env,
  stdout,
  stderr,
}: DefaultDepsOptions): DeliveryDeps {
  return {
    repoRoot,
    env,
    runner: createCommandRunner({ baseEnv: env, stdout, stderr }),
    files: createRepoFiles(repoRoot),
    github: createGithubActionsIo({ env, stdout, fetch }),
    stdout,
    stderr,
  };
}
