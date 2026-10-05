import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isGitIgnored } from './git-ignore.ts';

describe('isGitIgnored', () => {
  const createRepository = (): string => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'git-ignore-'));
    Bun.spawnSync(['git', 'init', '--quiet'], { cwd: repoRoot });
    writeFileSync(join(repoRoot, '.gitignore'), 'out\n');
    return repoRoot;
  };

  test('.gitignoreに一致するパスは、ファイルが無くても管理外と判定する', () => {
    const repoRoot = createRepository();
    try {
      expect(isGitIgnored(repoRoot, 'apps/app/out/result.png')).toBe(true);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('.gitignoreに一致しないパスは管理対象と判定する', () => {
    const repoRoot = createRepository();
    try {
      expect(isGitIgnored(repoRoot, 'apps/app/src/result.png')).toBe(false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('Gitリポジトリの外では判定できないため例外にする', () => {
    const outside = mkdtempSync(join(tmpdir(), 'git-ignore-outside-'));
    try {
      expect(() => isGitIgnored(outside, 'result.png')).toThrow(
        /git check-ignoreが失敗しました/,
      );
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
