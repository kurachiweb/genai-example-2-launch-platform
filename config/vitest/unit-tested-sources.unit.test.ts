import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { listUnitTestedSources } from './unit-tested-sources.ts';

let rootDir: string;

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), 'unit-tested-sources-'));
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

async function writeFiles(...paths: string[]): Promise<void> {
  for (const path of paths) {
    await mkdir(join(rootDir, dirname(path)), { recursive: true });
    await writeFile(join(rootDir, path), '');
  }
}

describe('listUnitTestedSources', () => {
  test('同名の単体テストを隣に持つソースを、起点からの相対パスで名前の順に返す', async () => {
    await writeFiles(
      'lib/workers/search/registry.ts',
      'lib/workers/search/registry.unit.test.ts',
      'lib/workers/search/targets/index.ts',
      'lib/workers/search/targets/index.unit.test.ts',
      'lib/workers/email/a.ts',
      'lib/workers/email/a.unit.test.ts',
    );

    expect(listUnitTestedSources(rootDir, 'lib/workers')).toEqual([
      'lib/workers/email/a.ts',
      'lib/workers/search/registry.ts',
      'lib/workers/search/targets/index.ts',
    ]);
  });

  test('単体テストを持たないソースと、Workers統合テストだけを持つソースを返さない', async () => {
    await writeFiles(
      'lib/workers/email/repository.ts',
      'lib/workers/email/repository.worker.test.ts',
      'lib/workers/email/sender.ts',
    );

    expect(listUnitTestedSources(rootDir, 'lib/workers')).toEqual([]);
  });

  test('対応するソースが無い単体テストは無視する', async () => {
    await writeFiles('lib/workers/search/orphan.unit.test.ts');

    expect(listUnitTestedSources(rootDir, 'lib/workers')).toEqual([]);
  });

  test('指定したディレクトリの外のソースを返さない', async () => {
    await writeFiles('src/a.ts', 'src/a.unit.test.ts');
    await mkdir(join(rootDir, 'lib/workers'), { recursive: true });

    expect(listUnitTestedSources(rootDir, 'lib/workers')).toEqual([]);
  });

  test('ディレクトリが無ければ空の一覧を返す', () => {
    expect(listUnitTestedSources(rootDir, 'lib/workers')).toEqual([]);
  });
});
