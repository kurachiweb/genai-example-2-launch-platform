import { APPS, SHARED_DIRS } from '../../../config/workspace-layout.ts';

export const ROOT_TARGET = '.';

export interface InstallLayout {
  readonly apps: readonly { readonly dir: string }[];
  readonly sharedDirs: readonly { readonly source: string }[];
}

export const WORKSPACE_LAYOUT: InstallLayout = {
  apps: APPS,
  sharedDirs: SHARED_DIRS,
};

export const packageJsonOf = (dir: string): string =>
  dir === ROOT_TARGET ? 'package.json' : `${dir}/package.json`;

export function installCandidates(
  layout: InstallLayout = WORKSPACE_LAYOUT,
): readonly string[] {
  return [
    ...new Set([
      ROOT_TARGET,
      ...layout.apps.map(({ dir }) => dir),
      ...layout.sharedDirs.map(({ source }) => source),
    ]),
  ];
}

export function resolveInstallTargets(
  existingPackageJsons: ReadonlySet<string>,
  layout: InstallLayout = WORKSPACE_LAYOUT,
): readonly string[] {
  if (!existingPackageJsons.has(packageJsonOf(ROOT_TARGET))) {
    throw new Error('ルートのpackage.jsonが見つかりません。');
  }
  return installCandidates(layout).filter((dir) =>
    existingPackageJsons.has(packageJsonOf(dir)),
  );
}
