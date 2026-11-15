import {
  createCommandRunner,
  type TextOutput,
} from '../../adapters/command-runner.ts';
import { createGithubActionsIo } from '../../adapters/github-actions.ts';
import { createHttpProbe } from '../../adapters/http-probe.ts';
import { createInfisicalSecretSource } from '../../adapters/infisical.ts';
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
  const runner = createCommandRunner({ baseEnv: env, stdout, stderr });
  return {
    repoRoot,
    env,
    runner,
    files: createRepoFiles(repoRoot),
    github: createGithubActionsIo({ env, stdout, fetch }),
    secrets: createInfisicalSecretSource({ runner }),
    probe: createHttpProbe({ fetch }),
    stdout,
    stderr,
  };
}
