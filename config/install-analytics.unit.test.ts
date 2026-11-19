import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  installCandidates,
  packageJsonOf,
} from '../scripts/delivery/core/install-targets.ts';

const REPO_ROOT = join(import.meta.dir, '..');

const SCARF_PACKAGE = '@scarf/scarf';

interface InstallTarget {
  readonly dir: string;
  readonly lockfile: string;
  readonly packageJson: string;
}

const lockfileOf = (dir: string): string =>
  dir === '.' ? 'bun.lock' : `${dir}/bun.lock`;

const installTargets = (): readonly InstallTarget[] =>
  installCandidates()
    .map((dir) => ({
      dir,
      lockfile: lockfileOf(dir),
      packageJson: packageJsonOf(dir),
    }))
    .filter(({ lockfile }) => existsSync(join(REPO_ROOT, lockfile)));

const readRepoFile = (repoRelativePath: string): string =>
  readFileSync(join(REPO_ROOT, repoRelativePath), 'utf8');

// 導入の後の処理が依存の木を外部の集計サービスへ送るパッケージは、Bunの既定の信頼済みの一覧にあり導入のたびに実行されるため、導入するディレクトリのpackage.jsonで送信を止める
const scarfDisabledIn = (packageJson: string): boolean => {
  const manifest = JSON.parse(readRepoFile(packageJson)) as {
    readonly scarfSettings?: { readonly enabled?: unknown };
  };
  return manifest.scarfSettings?.enabled === false;
};

describe('導入時の外部への送信の停止', () => {
  test('依存の木に@scarf/scarfを含むディレクトリは、package.jsonでscarfSettings.enabledをfalseにしている', () => {
    const missing = installTargets()
      .filter(({ lockfile }) =>
        readRepoFile(lockfile).includes(`"${SCARF_PACKAGE}@`),
      )
      .filter(({ packageJson }) => !scarfDisabledIn(packageJson))
      .map(({ packageJson }) => packageJson);

    expect(missing).toEqual([]);
  });

  test('検査の対象にルートと各アプリのロックファイルが含まれる', () => {
    const dirs = installTargets().map(({ dir }) => dir);

    expect(dirs).toContain('.');
    expect(dirs).toContain('apps/client');
  });
});
