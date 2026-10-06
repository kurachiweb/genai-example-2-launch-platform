import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { symlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  allTargetsIn,
  snapshotTree,
  SOURCE_FILES,
  statesOf,
  useRepositoryFixtures,
} from '../../test-support/shared-dirs-fixtures.ts';
import {
  type FileIdentityReader,
  placeByCopy,
  readFileIdentity,
} from './shared-dirs.ts';

const createRepository = useRepositoryFixtures();

const PAST = new Date('2001-01-01T00:00:00Z');

describe('placeByCopy(同一性を読めない配置先)', () => {
  test.each<[string, FileIdentityReader]>([
    ['同一性を読めない', () => undefined],
    ['同一性を読める', readFileIdentity],
  ])(
    '親ディレクトリのシンボリックリンクで配置先が配置元を指すとき、%s場合も配置元を変更しない',
    async (_label, readIdentity) => {
      const repoRoot = await createRepository({ consumerDirs: [] });
      await symlink('.', join(repoRoot, 'apps/api'));
      await writeFile(join(repoRoot, 'apps/package.json'), '{}\n');
      const source = snapshotTree(join(repoRoot, 'apps/db'));

      placeByCopy(repoRoot, readIdentity);

      expect(snapshotTree(join(repoRoot, 'apps/db'))).toEqual(source);
    },
  );

  test('同一性を読めない配置先は削除も複製もしない', async () => {
    const repoRoot = await createRepository({
      files: { ...SOURCE_FILES, 'apps/api/db/stale.ts': '' },
    });
    const unreadable = join(repoRoot, 'apps/api/db');

    const reports = placeByCopy(repoRoot, (path) =>
      path === unreadable ? undefined : readFileIdentity(path),
    );

    expect(statesOf(reports)).toEqual(
      allTargetsIn('copied', { 'apps/api/db': 'content-mismatch' }),
    );
    expect(readdirSync(unreadable)).toEqual(['stale.ts']);
  });
});

describe('placeByCopy(配置済みの配置先)', () => {
  test('すでにcopiedの配置先は削除も複製もし直さない', async () => {
    const repoRoot = await createRepository();
    placeByCopy(repoRoot);
    const placedFiles = [
      'apps/api/db/schema/users.ts',
      'apps/client/lib/components/button.tsx',
    ].map((path) => join(repoRoot, path));
    await Promise.all(placedFiles.map((path) => utimes(path, PAST, PAST)));
    const placed = snapshotTree(join(repoRoot, 'apps/api/db'));

    const reports = placeByCopy(repoRoot);

    expect(statesOf(reports)).toEqual(allTargetsIn('copied'));
    expect(placedFiles.map((path) => statSync(path).mtime)).toEqual([
      PAST,
      PAST,
    ]);
    expect(snapshotTree(join(repoRoot, 'apps/api/db'))).toEqual(placed);
  });

  test('内容が一致しない配置先は複製し直す', async () => {
    const repoRoot = await createRepository();
    placeByCopy(repoRoot);
    await writeFile(join(repoRoot, 'apps/api/db/stale.ts'), '');

    const reports = placeByCopy(repoRoot);

    expect(statesOf(reports)).toEqual(allTargetsIn('copied'));
    expect(existsSync(join(repoRoot, 'apps/api/db/stale.ts'))).toBe(false);
  });
});
