import type {
  CommandRunner,
  TextOutput,
} from '../../adapters/command-runner.ts';
import type { GithubActionsIo } from '../../adapters/github-actions.ts';
import type { HttpProbe } from '../../adapters/http-probe.ts';
import type { SecretSource } from '../../adapters/infisical.ts';
import type { RepoFiles } from '../../adapters/repo-files.ts';

export type { TextOutput };

export const EXIT_SUCCESS = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;

export interface DeliveryDeps {
  readonly repoRoot: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly runner: CommandRunner;
  readonly files: RepoFiles;
  readonly github: GithubActionsIo;
  readonly secrets: SecretSource;
  readonly probe: HttpProbe;
  readonly stdout: TextOutput;
  readonly stderr: TextOutput;
}

export interface DeliveryCommand {
  readonly name: string;
  readonly description: string;
  run(args: readonly string[], deps: DeliveryDeps): Promise<number>;
}

export class UsageError extends Error {
  override readonly name = 'UsageError';
}
