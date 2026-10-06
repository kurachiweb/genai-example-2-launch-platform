import { existsSync } from 'node:fs';
import { join } from 'node:path';

import husky from 'husky';

export type HookInstallResult =
  | { readonly status: 'installed' }
  | {
      readonly status: 'skipped';
      readonly reason: 'ci' | 'husky-disabled' | 'not-a-git-repository';
    };

type HookSkipReason = Extract<
  HookInstallResult,
  { readonly status: 'skipped' }
>['reason'];

type Env = Readonly<Record<string, string | undefined>>;

export interface HookInstallerDependencies {
  readonly env: Env;
  readonly gitDirExists: () => boolean;
  readonly runHusky: () => void;
}

interface TextOutput {
  readonly write: (text: string) => unknown;
}

export interface HookInstallerEntryDependencies {
  readonly env: Env;
  readonly cwd: string;
  readonly husky: () => string;
  readonly stdout: TextOutput;
  readonly stderr: TextOutput;
}

const SKIPPED_MESSAGES: Readonly<Record<HookSkipReason, string>> = {
  ci: 'CI環境のため、Gitフックの導入を飛ばしました。',
  'husky-disabled': '環境変数HUSKYが0のため、Gitフックの導入を飛ばしました。',
  'not-a-git-repository':
    'Gitの作業ツリーが無いため、Gitフックの導入を飛ばしました。',
};

export function installGitHooks({
  env,
  gitDirExists,
  runHusky,
}: HookInstallerDependencies): HookInstallResult {
  if (env.CI !== undefined && env.CI !== '') {
    return { status: 'skipped', reason: 'ci' };
  }
  // huskyはHUSKY=0のとき導入を拒否して理由を返すため、呼ぶ前に開発者の意図した無効化として扱う
  if (env.HUSKY === '0') {
    return { status: 'skipped', reason: 'husky-disabled' };
  }
  if (!gitDirExists()) {
    return { status: 'skipped', reason: 'not-a-git-repository' };
  }
  runHusky();
  return { status: 'installed' };
}

export function describeHookInstallResult(result: HookInstallResult): string {
  return result.status === 'installed'
    ? 'Gitフックを導入しました。'
    : SKIPPED_MESSAGES[result.reason];
}

// huskyは失敗しても例外を投げず理由の文字列を返すため、空でなければ失敗として扱う
function runHuskyOrThrow(husky: () => string): void {
  const failure = husky();
  if (failure !== '') {
    throw new Error(`Gitフックの導入に失敗しました: ${failure}`);
  }
}

export function runHookInstallerEntry({
  env,
  cwd,
  husky,
  stdout,
  stderr,
}: HookInstallerEntryDependencies): number {
  try {
    const result = installGitHooks({
      env,
      gitDirExists: () => existsSync(join(cwd, '.git')),
      runHusky: () => {
        runHuskyOrThrow(husky);
      },
    });
    stdout.write(`${describeHookInstallResult(result)}\n`);
    return 0;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = runHookInstallerEntry({
    env: process.env,
    // huskyはカレントディレクトリの.gitを前提に導入するため、同じ場所を確かめる
    cwd: process.cwd(),
    husky,
    stdout: process.stdout,
    stderr: process.stderr,
  });
}
