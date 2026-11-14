import { existsSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';

const UNIT_TEST_SUFFIX = '.unit.test.ts';

// coverage.includeのディレクトリの中で単体テストが検査するソースを、Workers統合テストの分母から外すために列挙する。
// 網羅は単体テストのカバレッジで数え、その種別のテストが読み込まないソースを0%として数えないようにする
export function listUnitTestedSources(
  rootDir: string,
  directory: string,
): string[] {
  const absoluteDirectory = join(rootDir, directory);
  if (!existsSync(absoluteDirectory)) {
    return [];
  }

  return readdirSync(absoluteDirectory, { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith(UNIT_TEST_SUFFIX))
    .map((path) => `${path.slice(0, -UNIT_TEST_SUFFIX.length)}.ts`)
    .filter((path) => existsSync(join(absoluteDirectory, path)))
    .map((path) => [directory, ...path.split(sep)].join('/'))
    .toSorted();
}
