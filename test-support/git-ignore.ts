const IGNORED_EXIT_CODE = 0;
const NOT_IGNORED_EXIT_CODE = 1;

// ファイルが実在しなくても.gitignoreの規則だけで判定する。判定できなかった場合は「管理対象」と誤認しないよう例外にする
export const isGitIgnored = (repoRoot: string, path: string): boolean => {
  const { exitCode, stderr } = Bun.spawnSync(
    ['git', 'check-ignore', '--no-index', '--quiet', path],
    { cwd: repoRoot },
  );

  if (exitCode === IGNORED_EXIT_CODE) {
    return true;
  }
  if (exitCode === NOT_IGNORED_EXIT_CODE) {
    return false;
  }
  throw new Error(
    `git check-ignoreが失敗しました(終了コード${String(exitCode)}): ${stderr.toString()}`,
  );
};
