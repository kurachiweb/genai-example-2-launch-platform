import { posix } from 'node:path';

import { APPS } from '../../../config/workspace-layout.ts';
import { ROOT_TARGET } from './install-targets.ts';

export const COVERAGE_KINDS = ['unit', 'browser', 'worker'] as const;

export type CoverageKind = (typeof COVERAGE_KINDS)[number];

export const MERGED_LCOV_PATH = 'coverage/merged/lcov.info';

export interface CoverageLayout {
  readonly apps: readonly { readonly dir: string }[];
}

const WORKSPACE_LAYOUT: CoverageLayout = { apps: APPS };

export interface LcovReport {
  readonly dir: string;
  readonly kind: CoverageKind;
  readonly path: string;
}

export interface LoadedLcov {
  readonly dir: string;
  readonly lcov: string;
}

const lcovPathOf = (dir: string, kind: CoverageKind): string => {
  const path = `coverage/${kind}/lcov.info`;
  return dir === ROOT_TARGET ? path : `${dir}/${path}`;
};

// 計測が出力先へ書き出し途中の一時ファイル(`.lcov.info.<乱数>.tmp`)を拾わないよう、パターンで探さず固定のパスだけを読む
export function lcovReportsOf(
  layout: CoverageLayout = WORKSPACE_LAYOUT,
): readonly LcovReport[] {
  return [ROOT_TARGET, ...layout.apps.map(({ dir }) => dir)].flatMap((dir) =>
    COVERAGE_KINDS.map((kind) => ({ dir, kind, path: lcovPathOf(dir, kind) })),
  );
}

const SOURCE_FILE_PREFIX = 'SF:';

const prefixedLine = (line: string, dir: string): string => {
  if (!line.startsWith(SOURCE_FILE_PREFIX)) return line;
  const path = line.slice(SOURCE_FILE_PREFIX.length);
  return posix.isAbsolute(path)
    ? line
    : `${SOURCE_FILE_PREFIX}${posix.join(dir, path)}`;
};

// 各アプリのlcovはアプリのディレクトリからの相対パスのため、合算後にアプリを区別できるようリポジトリのルートからのパスにする
export function prefixSourcePaths(lcov: string, dir: string): string {
  const lines = lcov.split(/\r?\n/);
  if (dir === ROOT_TARGET) return lines.join('\n');
  return lines.map((line) => prefixedLine(line, dir)).join('\n');
}

export function mergeLcov(reports: readonly LoadedLcov[]): string {
  const records = reports
    .map(({ dir, lcov }) => prefixSourcePaths(lcov, dir).trimEnd())
    .filter((text) => text !== '');
  return records.length === 0 ? '' : `${records.join('\n')}\n`;
}
