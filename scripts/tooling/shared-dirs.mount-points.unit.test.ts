import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  allTargetsIn,
  simulateBindMounts,
  snapshotTree,
  SOURCE_FILES,
  statesOf,
  useRepositoryFixtures,
} from '../../test-support/shared-dirs-fixtures.ts';
import {
  inspectPlacements,
  isMountPoint,
  type MountPointReader,
  placeByCopy,
  readFileIdentity,
  readMountPoints,
} from './shared-dirs.ts';

const createRepository = useRepositoryFixtures();

const mountedAt =
  (repoRoot: string, targets: readonly string[]): MountPointReader =>
  () =>
    new Set(targets.map((target) => realpathSync(join(repoRoot, target))));

const FOREIGN_FILES: Readonly<Record<string, string>> = {
  'apps/api/db/components/button.tsx': 'export const Button = () => null;\n',
};

describe('readMountPoints', () => {
  test('mountinfoの各行の5番目の欄を、8進数のエスケープを戻してマウント先として読み取る', async () => {
    const repoRoot = await createRepository({ consumerDirs: [], files: {} });
    const mountinfoPath = join(repoRoot, 'mountinfo');
    await writeFile(
      mountinfoPath,
      [
        '171 148 0:42 /home/dev/project /workspace rw,nosuid - virtiofs host rw',
        '185 171 0:42 /home/dev/project/apps/db /workspace/apps/api/db rw master:1 - virtiofs host rw',
        '190 171 0:42 /home/dev/my\\040project /workspace/with\\040space\\011tab\\134slash rw - virtiofs host rw',
        '',
      ].join('\n'),
    );

    expect(readMountPoints(mountinfoPath)).toEqual(
      new Set([
        '/workspace',
        '/workspace/apps/api/db',
        '/workspace/with space\ttab\\slash',
      ]),
    );
  });

  test('mountinfoが無ければマウントポイントは無いものとして扱う', async () => {
    const repoRoot = await createRepository({ consumerDirs: [], files: {} });

    expect(readMountPoints(join(repoRoot, 'missing'))).toEqual(new Set());
  });

  test('既定では実行中のプロセスのmountinfoを読む', () => {
    expect(readMountPoints().has('/')).toBe(existsSync('/proc/self/mountinfo'));
  });
});

describe('isMountPoint', () => {
  test('シンボリックリンクを含むパスでも、実パスがマウント先と一致すればマウントポイントとみなす', async () => {
    const repoRoot = await createRepository({
      consumerDirs: [],
      files: { 'apps/api/db/schema/users.ts': '' },
    });
    await symlink('.', join(repoRoot, 'self-link'));
    const mountPoints = mountedAt(repoRoot, ['apps/api/db'])();

    expect(
      isMountPoint(join(repoRoot, 'self-link/apps/api/db'), mountPoints),
    ).toBe(true);
    expect(isMountPoint(join(repoRoot, 'apps/api/db'), mountPoints)).toBe(true);
    expect(
      isMountPoint(join(repoRoot, 'apps/api/db/schema'), mountPoints),
    ).toBe(false);
    expect(isMountPoint(join(repoRoot, 'apps/api'), mountPoints)).toBe(false);
  });
});

describe('inspectPlacements(マウントポイント)', () => {
  test('配置元と同じ実体のマウントポイントはbind-mountedになる', async () => {
    const repoRoot = await createRepository({
      files: { ...SOURCE_FILES, 'apps/api/db/stale.ts': '' },
    });

    const reports = inspectPlacements(
      repoRoot,
      simulateBindMounts(repoRoot, ['apps/api/db']),
      mountedAt(repoRoot, ['apps/api/db']),
    );

    expect(statesOf(reports)).toEqual(
      allTargetsIn('missing', { 'apps/api/db': 'bind-mounted' }),
    );
  });

  test('配置元と異なる実体のマウントポイントは、内容が一致していてもmount-mismatchになる', async () => {
    const repoRoot = await createRepository();
    placeByCopy(repoRoot);

    const reports = inspectPlacements(
      repoRoot,
      readFileIdentity,
      mountedAt(repoRoot, ['apps/api/db']),
    );

    expect(statesOf(reports)).toEqual(
      allTargetsIn('copied', { 'apps/api/db': 'mount-mismatch' }),
    );
  });

  test('同一性を読めないマウントポイントはmount-mismatchになる', async () => {
    const repoRoot = await createRepository();
    placeByCopy(repoRoot);

    const reports = inspectPlacements(
      repoRoot,
      () => undefined,
      mountedAt(repoRoot, ['apps/client/lib']),
    );

    expect(statesOf(reports)).toEqual(
      allTargetsIn('copied', { 'apps/client/lib': 'mount-mismatch' }),
    );
  });
});

describe('placeByCopy(マウントポイント)', () => {
  test('配置元以外の実体がマウントされた配置先には書き込まず、mount-mismatchと報告する', async () => {
    const repoRoot = await createRepository({
      files: { ...SOURCE_FILES, ...FOREIGN_FILES },
    });
    const mounted = snapshotTree(join(repoRoot, 'apps/api/db'));

    const reports = placeByCopy(
      repoRoot,
      readFileIdentity,
      mountedAt(repoRoot, ['apps/api/db']),
    );

    expect(statesOf(reports)).toEqual(
      allTargetsIn('copied', { 'apps/api/db': 'mount-mismatch' }),
    );
    expect(snapshotTree(join(repoRoot, 'apps/api/db'))).toEqual(mounted);
  });

  test('ファイルがマウントされた配置先も削除せず、mount-mismatchと報告する', async () => {
    const repoRoot = await createRepository({
      files: { ...SOURCE_FILES, 'apps/event/lib': 'host file\n' },
    });

    const reports = placeByCopy(
      repoRoot,
      readFileIdentity,
      mountedAt(repoRoot, ['apps/event/lib']),
    );

    expect(statesOf(reports)).toEqual(
      allTargetsIn('copied', { 'apps/event/lib': 'mount-mismatch' }),
    );
    expect(readFileSync(join(repoRoot, 'apps/event/lib'), 'utf8')).toBe(
      'host file\n',
    );
  });

  test('マウントポイントでない配置先には、マウント情報に関わらずコピーで配置する', async () => {
    const repoRoot = await createRepository();
    await mkdir(join(repoRoot, 'apps/api/db'));

    const reports = placeByCopy(
      repoRoot,
      readFileIdentity,
      mountedAt(repoRoot, ['apps/api']),
    );

    expect(statesOf(reports)).toEqual(allTargetsIn('copied'));
  });
});
