import { describe, expect, test } from 'bun:test';
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
} from 'node:fs';
import { copyFile, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  allTargetsIn,
  MOUNTS,
  reportsIn,
  simulateBindMounts,
  snapshotTree,
  SOURCE_FILES,
  SOURCE_NODE_MODULES_FILES,
  statesOf,
  useRepositoryFixtures,
  withoutSourceDir,
  writeFixtureFiles,
} from '../../test-support/shared-dirs-fixtures.ts';
import {
  describeProblem,
  formatPlacementTable,
  inspectPlacements,
  type PlacementReport,
  type PlacementState,
  placeByCopy,
  readFileIdentity,
  runSharedDirsEntry,
} from './shared-dirs.ts';

const REPO_ROOT = join(import.meta.dirname, '../..');
const SPAWN_TIMEOUT_MS = 30_000;

const OK_MESSAGE = '共有ディレクトリの配置に問題はありません。\n';

const USAGE_MESSAGE = [
  '使い方: bun scripts/tooling/shared-dirs.ts <verify|place>',
  '  verify: 共有ディレクトリの配置状態を確認する',
  '  place: bind mountされていない配置先へ共有ディレクトリをコピーで配置し、配置状態を確認する',
  '',
].join('\n');

const CI_OR_MOUNT_GUIDANCE =
  'CIでは`bun run shared-dirs:place`を実行してください。ローカルではcompose.yamlで配置元が配置先へbind mountされているか確認してください。';

const createRepository = useRepositoryFixtures();

describe('inspectPlacements', () => {
  test('配置定義のすべての配置先を、配置元とともに定義順に報告する', async () => {
    const repoRoot = await createRepository();

    const reports = inspectPlacements(repoRoot);

    expect(reports.map(({ source, target }) => ({ source, target }))).toEqual(
      MOUNTS,
    );
  });

  test('利用側アプリにpackage.jsonが無ければ、配置先の状態に関わらずconsumer-missingになる', async () => {
    const repoRoot = await createRepository({
      consumerDirs: [],
      files: {
        ...SOURCE_FILES,
        'apps/api/db/stale.ts': '',
        'apps/client/lib/node_modules/react/package.json': '{}\n',
      },
    });

    expect(statesOf(inspectPlacements(repoRoot))).toEqual(
      allTargetsIn('consumer-missing'),
    );
  });

  test('利用側アプリがあり配置先が無ければmissingになる', async () => {
    const repoRoot = await createRepository();

    expect(statesOf(inspectPlacements(repoRoot))).toEqual(
      allTargetsIn('missing'),
    );
  });

  test('配置元が無く配置先も無ければmissingになる', async () => {
    const repoRoot = await createRepository({
      files: withoutSourceDir('apps/backend-lib'),
    });
    placeByCopy(repoRoot);
    await rm(join(repoRoot, 'apps/api/lib'), { recursive: true });

    expect(statesOf(inspectPlacements(repoRoot))).toEqual(
      allTargetsIn('copied', { 'apps/api/lib': 'missing' }),
    );
  });

  test('配置先のnode_modulesが空ならcopiedのままになる', async () => {
    const repoRoot = await createRepository();
    placeByCopy(repoRoot);
    await mkdir(join(repoRoot, 'apps/api/db/node_modules'));

    expect(statesOf(inspectPlacements(repoRoot))).toEqual(
      allTargetsIn('copied'),
    );
  });

  test('配置先のnode_modulesに中身があればnon-empty-node-modulesになる', async () => {
    const repoRoot = await createRepository();
    placeByCopy(repoRoot);
    await writeFixtureFiles(repoRoot, {
      'apps/client/lib/node_modules/react/package.json': '{"name":"react"}\n',
    });

    expect(statesOf(inspectPlacements(repoRoot))).toEqual(
      allTargetsIn('copied', { 'apps/client/lib': 'non-empty-node-modules' }),
    );
  });

  test.each<[string, (repoRoot: string) => Promise<void>]>([
    [
      '配置先にだけファイルがある',
      async (repoRoot) => {
        await writeFile(join(repoRoot, 'apps/api/db/extra.ts'), '');
      },
    ],
    [
      '配置先にファイルが無い',
      async (repoRoot) => {
        await rm(join(repoRoot, 'apps/api/db/schema/users.ts'));
      },
    ],
    [
      '配置先のファイルのサイズが異なる',
      async (repoRoot) => {
        await writeFile(join(repoRoot, 'apps/api/db/index.ts'), 'changed\n');
      },
    ],
    [
      '配置先がファイルである',
      async (repoRoot) => {
        await rm(join(repoRoot, 'apps/api/db'), { recursive: true });
        await writeFile(join(repoRoot, 'apps/api/db'), '');
      },
    ],
  ])('%sならcontent-mismatchになる', async (_label, breakPlacement) => {
    const repoRoot = await createRepository();
    placeByCopy(repoRoot);
    await breakPlacement(repoRoot);

    expect(statesOf(inspectPlacements(repoRoot))).toEqual(
      allTargetsIn('copied', { 'apps/api/db': 'content-mismatch' }),
    );
  });

  test('配置先が配置元へのシンボリックリンクなら、bind mountとみなさずcontent-mismatchになる', async () => {
    const repoRoot = await createRepository();
    placeByCopy(repoRoot);
    await rm(join(repoRoot, 'apps/api/db'), { recursive: true });
    await symlink('../db', join(repoRoot, 'apps/api/db'));

    expect(statesOf(inspectPlacements(repoRoot))).toEqual(
      allTargetsIn('copied', { 'apps/api/db': 'content-mismatch' }),
    );
  });

  test('配置元のシンボリックリンクに対し配置先が同じサイズの通常ファイルなら、content-mismatchになる', async () => {
    const repoRoot = await createRepository();
    await symlink('index.ts', join(repoRoot, 'apps/db/alias.ts'));
    placeByCopy(repoRoot);
    await rm(join(repoRoot, 'apps/api/db/alias.ts'));
    await writeFile(
      join(repoRoot, 'apps/api/db/alias.ts'),
      'x'.repeat('index.ts'.length),
    );

    expect(statesOf(inspectPlacements(repoRoot))).toEqual(
      allTargetsIn('copied', { 'apps/api/db': 'content-mismatch' }),
    );
  });

  test('配置先のinode・デバイスが配置元と一致すれば、内容に関わらずbind-mountedになる', async () => {
    const repoRoot = await createRepository({
      files: { ...SOURCE_FILES, 'apps/api/db/stale.ts': '' },
    });

    const reports = inspectPlacements(
      repoRoot,
      simulateBindMounts(repoRoot, ['apps/api/db']),
    );

    expect(statesOf(reports)).toEqual(
      allTargetsIn('missing', { 'apps/api/db': 'bind-mounted' }),
    );
  });

  test('bind mountでも配置先のnode_modulesに中身があれば、non-empty-node-modulesになる', async () => {
    const repoRoot = await createRepository({
      files: {
        ...SOURCE_FILES,
        'apps/api/db/node_modules/drizzle-orm/package.json': '{}\n',
      },
    });

    const reports = inspectPlacements(
      repoRoot,
      simulateBindMounts(repoRoot, ['apps/api/db']),
    );

    expect(statesOf(reports)).toEqual(
      allTargetsIn('missing', { 'apps/api/db': 'non-empty-node-modules' }),
    );
  });
});

describe('placeByCopy', () => {
  test('配置元をnode_modulesを除いて複製し、すべての配置先がcopiedになる', async () => {
    const repoRoot = await createRepository();

    const reports = placeByCopy(repoRoot);

    expect(statesOf(reports)).toEqual(allTargetsIn('copied'));
    expect(
      readFileSync(join(repoRoot, 'apps/event/db/schema/users.ts'), 'utf8'),
    ).toBe(SOURCE_FILES['apps/db/schema/users.ts'] ?? '');
    expect(existsSync(join(repoRoot, 'apps/api/db/node_modules'))).toBe(false);
    expect(existsSync(join(repoRoot, 'apps/admin/lib/node_modules'))).toBe(
      false,
    );
  });

  test('配置元が無い共有ディレクトリは、空の配置先を作ってcopiedになる', async () => {
    const repoRoot = await createRepository({
      files: withoutSourceDir('apps/backend-lib'),
    });

    const reports = placeByCopy(repoRoot);

    expect(statesOf(reports)).toEqual(allTargetsIn('copied'));
    expect(readdirSync(join(repoRoot, 'apps/api/lib'))).toEqual([]);
    expect(readdirSync(join(repoRoot, 'apps/event/lib'))).toEqual([]);
  });

  test('配置先に残った古いファイルを削除して複製し直し、繰り返してもcopiedのままになる', async () => {
    const repoRoot = await createRepository({
      files: {
        ...SOURCE_FILES,
        'apps/api/db/stale/old.ts': '',
        'apps/api/db/index.ts': 'changed\n',
      },
    });

    placeByCopy(repoRoot);
    const reports = placeByCopy(repoRoot);

    expect(statesOf(reports)).toEqual(allTargetsIn('copied'));
    expect(existsSync(join(repoRoot, 'apps/api/db/stale'))).toBe(false);
    expect(readFileSync(join(repoRoot, 'apps/api/db/index.ts'), 'utf8')).toBe(
      SOURCE_FILES['apps/db/index.ts'] ?? '',
    );
  });

  test('配置先のnode_modulesは削除せずに残し、中身があればnon-empty-node-modulesと報告する', async () => {
    const repoRoot = await createRepository({
      files: {
        ...SOURCE_FILES,
        'apps/api/db/stale.ts': '',
        'apps/api/db/node_modules/drizzle-orm/package.json': '{}\n',
      },
    });

    const reports = placeByCopy(repoRoot);

    expect(statesOf(reports)).toEqual(
      allTargetsIn('copied', { 'apps/api/db': 'non-empty-node-modules' }),
    );
    expect(existsSync(join(repoRoot, 'apps/api/db/stale.ts'))).toBe(false);
    expect(
      existsSync(
        join(repoRoot, 'apps/api/db/node_modules/drizzle-orm/package.json'),
      ),
    ).toBe(true);
    expect(existsSync(join(repoRoot, 'apps/api/db/index.ts'))).toBe(true);
  });

  test('シンボリックリンクはリンク先の文字列を変えずに複製する', async () => {
    const repoRoot = await createRepository();
    await symlink(
      'button.tsx',
      join(repoRoot, 'apps/frontend-lib/components/index.tsx'),
    );

    const reports = placeByCopy(repoRoot);

    expect(statesOf(reports)).toEqual(allTargetsIn('copied'));
    expect(
      readlinkSync(join(repoRoot, 'apps/client/lib/components/index.tsx')),
    ).toBe('button.tsx');
  });

  test('配置先がファイルやほかのディレクトリへのシンボリックリンクなら、それ自体を取り除いて複製し、リンク先を変更しない', async () => {
    const repoRoot = await createRepository({
      files: {
        ...SOURCE_FILES,
        'apps/api/db': '',
        'elsewhere/keep.ts': 'keep\n',
      },
    });
    await symlink('../../elsewhere', join(repoRoot, 'apps/event/db'));

    const reports = placeByCopy(repoRoot);

    expect(statesOf(reports)).toEqual(allTargetsIn('copied'));
    expect(lstatSync(join(repoRoot, 'apps/event/db')).isDirectory()).toBe(true);
    expect(readdirSync(join(repoRoot, 'elsewhere'))).toEqual(['keep.ts']);
  });

  test('配置先が配置元へのシンボリックリンクなら、リンク自体だけを取り除いて複製し、配置元を変更しない', async () => {
    const repoRoot = await createRepository();
    await symlink('../db', join(repoRoot, 'apps/api/db'));
    const source = snapshotTree(join(repoRoot, 'apps/db'));

    const reports = placeByCopy(repoRoot);

    expect(statesOf(reports)).toEqual(allTargetsIn('copied'));
    expect(lstatSync(join(repoRoot, 'apps/api/db')).isDirectory()).toBe(true);
    expect(snapshotTree(join(repoRoot, 'apps/db'))).toEqual(source);
  });

  test('bind mountの配置先には書き込まない', async () => {
    const repoRoot = await createRepository({
      files: {
        ...SOURCE_FILES,
        ...SOURCE_NODE_MODULES_FILES,
        'apps/api/db/stale.ts': '',
        'apps/client/lib/stale.ts': '',
        'apps/client/lib/node_modules/react/package.json': '{}\n',
      },
    });

    const reports = placeByCopy(
      repoRoot,
      simulateBindMounts(repoRoot, ['apps/api/db', 'apps/client/lib']),
    );

    expect(statesOf(reports)).toEqual(
      allTargetsIn('copied', {
        'apps/api/db': 'bind-mounted',
        'apps/client/lib': 'non-empty-node-modules',
      }),
    );
    expect(readdirSync(join(repoRoot, 'apps/api/db'))).toEqual(['stale.ts']);
    expect(readdirSync(join(repoRoot, 'apps/client/lib')).toSorted()).toEqual([
      'node_modules',
      'stale.ts',
    ]);
  });

  test('利用側アプリが無い配置先には何も作らない', async () => {
    const repoRoot = await createRepository({
      consumerDirs: ['apps/client', 'apps/admin'],
    });

    const reports = placeByCopy(repoRoot);

    expect(statesOf(reports)).toEqual(
      allTargetsIn('consumer-missing', {
        'apps/client/lib': 'copied',
        'apps/admin/lib': 'copied',
      }),
    );
    expect(existsSync(join(repoRoot, 'apps/api'))).toBe(false);
    expect(existsSync(join(repoRoot, 'apps/event'))).toBe(false);
  });
});

describe('readFileIdentity', () => {
  test('同じ実体を指すパスは同じinode・デバイスになり、別のディレクトリとは異なる', async () => {
    const repoRoot = await createRepository();
    await symlink('db', join(repoRoot, 'apps/db-link'));

    const identity = readFileIdentity(join(repoRoot, 'apps/db'));

    expect(identity).toBeDefined();
    expect(readFileIdentity(join(repoRoot, 'apps/db-link'))).toEqual(identity);
    expect(readFileIdentity(join(repoRoot, 'apps/frontend-lib'))).not.toEqual(
      identity,
    );
  });

  test('存在しないパスはundefinedになる', async () => {
    const repoRoot = await createRepository();

    expect(readFileIdentity(join(repoRoot, 'apps/missing'))).toBeUndefined();
  });
});

describe('describeProblem', () => {
  const reportOf = (state: PlacementState): PlacementReport => ({
    source: 'apps/db',
    target: 'apps/api/db',
    state,
  });

  test.each<[PlacementState, string]>([
    ['missing', `apps/api/dbがありません。${CI_OR_MOUNT_GUIDANCE}`],
    [
      'content-mismatch',
      `apps/api/dbの内容がapps/dbと一致しません。${CI_OR_MOUNT_GUIDANCE}`,
    ],
    [
      'non-empty-node-modules',
      'apps/api/db/node_modulesに中身があり、共有ディレクトリと利用側アプリで同じパッケージが別々の実体として読み込まれます。compose.yamlの変更後にコンテナを再作成してください(ホストで`docker compose up -d`を実行する)。',
    ],
    [
      'mount-mismatch',
      'apps/api/dbはマウントポイントですが、apps/dbと同じ実体であることを確認できません。`bun run shared-dirs:place`もマウントポイントには書き込まないため、compose.yamlでapps/dbがapps/api/dbへbind mountされているか確認し、修正後にコンテナを再作成してください(ホストで`docker compose up -d`を実行する)。',
    ],
  ])('%sには案内文を返す', (state, expected) => {
    expect(describeProblem(reportOf(state))).toBe(expected);
  });

  test.each<PlacementState>(['bind-mounted', 'copied', 'consumer-missing'])(
    '%sは問題ではないためundefinedを返す',
    (state) => {
      expect(describeProblem(reportOf(state))).toBeUndefined();
    },
  );
});

describe('formatPlacementTable', () => {
  test('配置元・配置先・状態を表示幅でそろえた表にする', () => {
    const table = formatPlacementTable([
      { source: 'apps/db', target: 'apps/api/db', state: 'bind-mounted' },
      {
        source: 'apps/frontend-lib',
        target: 'apps/client/lib',
        state: 'non-empty-node-modules',
      },
      { source: 'apps/backend-lib', target: 'apps/api/lib', state: 'copied' },
    ]);

    expect(table).toBe(
      [
        '配置元             配置先           状態',
        'apps/db            apps/api/db      bind mount(bind-mounted)',
        'apps/frontend-lib  apps/client/lib  node_modulesの中身あり(non-empty-node-modules)',
        'apps/backend-lib   apps/api/lib     コピー(copied)',
        '',
      ].join('\n'),
    );
  });

  test.each<[PlacementState, string]>([
    ['consumer-missing', '利用側アプリ未作成で対象外(consumer-missing)'],
    ['missing', '欠落(missing)'],
    ['content-mismatch', '内容不一致(content-mismatch)'],
    ['mount-mismatch', 'マウント不一致(mount-mismatch)'],
  ])('%sの状態を%sと表示する', (state, label) => {
    const table = formatPlacementTable([
      { source: 'apps/db', target: 'apps/api/db', state },
    ]);

    expect(table.split('\n')[1]).toEndWith(`  ${label}`);
  });
});

const createOutput = () => {
  const written: string[] = [];
  return {
    write: (text: string) => {
      written.push(text);
    },
    text: () => written.join(''),
  };
};

const runEntryInProcess = (repoRoot: string, args: readonly string[]) => {
  const stdout = createOutput();
  const stderr = createOutput();
  const exitCode = runSharedDirsEntry({ args, repoRoot, stdout, stderr });
  return { exitCode, stdout: stdout.text(), stderr: stderr.text() };
};

describe('runSharedDirsEntry', () => {
  test('verifyで問題が無ければ状態の表を表示して0を返し、何も書き込まない', async () => {
    const repoRoot = await createRepository({ consumerDirs: [] });

    const { exitCode, stdout, stderr } = runEntryInProcess(repoRoot, [
      'verify',
    ]);

    expect(stdout).toBe(
      `${formatPlacementTable(reportsIn('consumer-missing'))}${OK_MESSAGE}`,
    );
    expect(stderr).toBe('');
    expect(exitCode).toBe(0);
    expect(existsSync(join(repoRoot, 'apps/client'))).toBe(false);
  });

  test('verifyで問題があれば状態の表と問題ごとの案内文を表示して1を返す', async () => {
    const repoRoot = await createRepository();
    placeByCopy(repoRoot);
    await rm(join(repoRoot, 'apps/api/db'), { recursive: true });
    await writeFixtureFiles(repoRoot, {
      'apps/admin/lib/node_modules/react/package.json': '{}\n',
    });
    const reports = reportsIn('copied', {
      'apps/api/db': 'missing',
      'apps/admin/lib': 'non-empty-node-modules',
    });

    const { exitCode, stdout, stderr } = runEntryInProcess(repoRoot, [
      'verify',
    ]);

    expect(stdout).toBe(formatPlacementTable(reports));
    expect(stderr).toBe(
      [
        '共有ディレクトリの配置に問題が2件あります。',
        ...reports.flatMap((report) => {
          const problem = describeProblem(report);
          return problem === undefined ? [] : [`  ${problem}`];
        }),
        '',
      ].join('\n'),
    );
    expect(exitCode).toBe(1);
  });

  test('placeでコピー配置してから状態の表を表示し、問題が無ければ0を返す', async () => {
    const repoRoot = await createRepository();

    const { exitCode, stdout, stderr } = runEntryInProcess(repoRoot, ['place']);

    expect(stdout).toBe(
      `${formatPlacementTable(reportsIn('copied'))}${OK_MESSAGE}`,
    );
    expect(stderr).toBe('');
    expect(exitCode).toBe(0);
  });

  test('placeの後も問題が残れば1を返す', async () => {
    const repoRoot = await createRepository({
      files: {
        ...SOURCE_FILES,
        'apps/event/lib/node_modules/hono/package.json': '{}\n',
      },
    });

    const { exitCode, stderr } = runEntryInProcess(repoRoot, ['place']);

    expect(stderr).toStartWith('共有ディレクトリの配置に問題が1件あります。\n');
    expect(exitCode).toBe(1);
  });

  test.each<[string, readonly string[]]>([
    ['無い', []],
    ['未知である', ['check']],
    ['多すぎる', ['verify', 'place']],
  ])(
    '引数が%sなら使い方を表示して1を返し、何も書き込まない',
    async (_label, args) => {
      const repoRoot = await createRepository();

      const { exitCode, stdout, stderr } = runEntryInProcess(repoRoot, args);

      expect(stdout).toBe('');
      expect(stderr).toBe(USAGE_MESSAGE);
      expect(exitCode).toBe(1);
      expect(existsSync(join(repoRoot, 'apps/api/db'))).toBe(false);
    },
  );

  test.each<[string, string]>([
    ['verify', '共有ディレクトリの配置状態を確認できませんでした: '],
    ['place', '共有ディレクトリをコピーで配置できませんでした: '],
  ])(
    '%sでファイル操作に失敗すれば理由を表示して1を返す',
    async (mode, prefix) => {
      const repoRoot = await createRepository({
        files: {
          ...withoutSourceDir('apps/db'),
          'apps/db': 'not a directory\n',
          'apps/api/db/index.ts': '',
        },
      });

      const { exitCode, stdout, stderr } = runEntryInProcess(repoRoot, [mode]);

      expect(stdout).toBe('');
      expect(stderr).toStartWith(prefix);
      expect(exitCode).toBe(1);
    },
  );
});

describe('直接実行したときの入口', () => {
  const createRepositoryWithScript = async (): Promise<string> => {
    const repoRoot = await createRepository();
    for (const path of [
      'scripts/tooling/shared-dirs.ts',
      'config/workspace-layout.ts',
    ]) {
      await mkdir(dirname(join(repoRoot, path)), { recursive: true });
      await copyFile(join(REPO_ROOT, path), join(repoRoot, path));
    }
    return repoRoot;
  };

  const runEntry = (repoRoot: string, mode: string) =>
    Bun.spawnSync(
      [
        process.execPath,
        join(repoRoot, 'scripts/tooling/shared-dirs.ts'),
        mode,
      ],
      {
        // カレントディレクトリに依らずスクリプトのあるリポジトリを対象にすることを確かめるため、サブディレクトリから実行する
        cwd: join(repoRoot, 'apps'),
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );

  test(
    '配置前のverifyは失敗し、placeの後のverifyはcopiedで成功する',
    async () => {
      const repoRoot = await createRepositoryWithScript();

      const before = runEntry(repoRoot, 'verify');
      const placed = runEntry(repoRoot, 'place');
      const after = runEntry(repoRoot, 'verify');

      expect(before.stdout.toString()).toBe(
        formatPlacementTable(reportsIn('missing')),
      );
      expect(before.exitCode).toBe(1);
      expect(placed.exitCode).toBe(0);
      expect(after.stdout.toString()).toBe(
        `${formatPlacementTable(reportsIn('copied'))}${OK_MESSAGE}`,
      );
      expect(after.stderr.toString()).toBe('');
      expect(after.exitCode).toBe(0);
    },
    SPAWN_TIMEOUT_MS,
  );
});
