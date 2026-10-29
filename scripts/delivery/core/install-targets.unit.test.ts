import { describe, expect, test } from 'bun:test';

import {
  type InstallLayout,
  installCandidates,
  packageJsonOf,
  resolveInstallTargets,
  WORKSPACE_LAYOUT,
} from './install-targets.ts';

const LAYOUT: InstallLayout = {
  apps: [{ dir: 'apps/api' }, { dir: 'apps/frontend-lib' }],
  sharedDirs: [
    { source: 'apps/db' },
    { source: 'apps/backend-lib' },
    { source: 'apps/frontend-lib' },
  ],
};

const packageJsonsOf = (dirs: readonly string[]): ReadonlySet<string> =>
  new Set(dirs.map(packageJsonOf));

describe('packageJsonOf', () => {
  test('ルートは直下の、それ以外はディレクトリの中のpackage.jsonを指す', () => {
    expect(packageJsonOf('.')).toBe('package.json');
    expect(packageJsonOf('apps/api')).toBe('apps/api/package.json');
  });
});

describe('installCandidates', () => {
  test('ルート・アプリの一覧・共有ディレクトリの配置元の順に、重複を除いて並べる', () => {
    expect(installCandidates(LAYOUT)).toEqual([
      '.',
      'apps/api',
      'apps/frontend-lib',
      'apps/db',
      'apps/backend-lib',
    ]);
  });
});

describe('resolveInstallTargets', () => {
  test('候補のうちpackage.jsonを持つものだけを、候補の順のまま導入の対象にする', () => {
    const existing = packageJsonsOf(['.', 'apps/db', 'apps/frontend-lib']);

    expect(resolveInstallTargets(existing, LAYOUT)).toEqual([
      '.',
      'apps/frontend-lib',
      'apps/db',
    ]);
  });

  test('共有ディレクトリにpackage.jsonを持つ配置元(apps/common-lib)を加えると、自動で対象に入る', () => {
    const layout: InstallLayout = {
      ...LAYOUT,
      sharedDirs: [...LAYOUT.sharedDirs, { source: 'apps/common-lib' }],
    };
    const existing = packageJsonsOf(['.', 'apps/api', 'apps/common-lib']);

    expect(resolveInstallTargets(existing, layout)).toEqual([
      '.',
      'apps/api',
      'apps/common-lib',
    ]);
  });

  test('package.jsonを持たない共有ディレクトリの配置元は対象にしない', () => {
    const layout: InstallLayout = {
      ...LAYOUT,
      sharedDirs: [{ source: 'apps/common-lib' }],
    };

    expect(resolveInstallTargets(packageJsonsOf(['.']), layout)).toEqual(['.']);
  });

  test('ルートのpackage.jsonが無ければ、リポジトリのルートでないとして失敗する', () => {
    expect(() =>
      resolveInstallTargets(packageJsonsOf(['apps/api']), LAYOUT),
    ).toThrow('ルートのpackage.jsonが見つかりません。');
  });

  test('既定ではconfig/workspace-layout.tsのアプリの一覧と共有ディレクトリを使う', () => {
    expect(installCandidates()).toEqual(installCandidates(WORKSPACE_LAYOUT));
    expect(installCandidates()).toEqual([
      '.',
      'apps/api',
      'apps/event',
      'apps/frontend-lib',
      'apps/client',
      'apps/admin',
      'apps/db',
      'apps/backend-lib',
    ]);
  });
});
