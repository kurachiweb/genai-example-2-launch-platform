import type { Configuration } from 'lint-staged';

import {
  createWorkspaceChecks,
  describePlanError,
  planStagedTasks,
  toCommands,
  type WorkspaceChecks,
} from './scripts/tooling/staged-tasks.ts';

export type StagedFilesTask = (
  stagedAbsolutePaths: readonly string[],
) => string[];

// lint-stagedはコマンド文字列をシェルを介さず空白と引用符で分割し、引用符の中のエスケープを解釈しない。案内文はJSONの文字列リテラルとして埋め込み、外側の単引用符と衝突しないよう単引用符だけをエスケープ表記にする
const toFailureCommand = (message: string): string => {
  const literal = JSON.stringify(message).replaceAll("'", String.raw`\u0027`);
  return `bun -e 'console.error(${literal});process.exit(1)'`;
};

export const createStagedFilesTask =
  (repoRoot: string, checks: WorkspaceChecks): StagedFilesTask =>
  (stagedAbsolutePaths) => {
    const result = planStagedTasks(
      stagedAbsolutePaths,
      repoRoot,
      checks.isInstalled,
      checks.appExists,
    );
    if (!result.ok) {
      const message = result.errors
        .map((error) => describePlanError(error, repoRoot))
        .join('\n');
      return [toFailureCommand(message)];
    }
    return [...toCommands(result.plan, repoRoot)];
  };

const config = {
  '*': createStagedFilesTask(
    import.meta.dirname,
    createWorkspaceChecks(import.meta.dirname),
  ),
} satisfies Configuration;

export default config;
