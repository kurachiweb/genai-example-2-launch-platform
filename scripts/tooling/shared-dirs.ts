import {
  copyFileSync,
  type Dirent,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

import { APPS, SHARED_DIRS } from '../../config/workspace-layout.ts';

export type PlacementState =
  | 'bind-mounted'
  | 'copied'
  | 'consumer-missing'
  | 'missing'
  | 'content-mismatch'
  | 'mount-mismatch'
  | 'non-empty-node-modules';

export interface PlacementReport {
  readonly source: string;
  readonly target: string;
  readonly state: PlacementState;
}

export interface FileIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
}

export type FileIdentityReader = (path: string) => FileIdentity | undefined;

export type MountPointReader = () => ReadonlySet<string>;

interface TextOutput {
  readonly write: (text: string) => unknown;
}

export interface SharedDirsEntryDependencies {
  readonly args: readonly string[];
  readonly repoRoot: string;
  readonly stdout: TextOutput;
  readonly stderr: TextOutput;
}

interface Placement {
  readonly source: string;
  readonly target: string;
  readonly consumerDir: string | undefined;
}

interface TreeEntry {
  readonly path: string;
  readonly kind: 'directory' | 'file' | 'symlink';
}

const NODE_MODULES = 'node_modules';

const MOUNTINFO_PATH = '/proc/self/mountinfo';
const MOUNT_POINT_FIELD_INDEX = 4;

const STATE_LABELS: Readonly<Record<PlacementState, string>> = {
  'bind-mounted': 'bind mount',
  copied: 'コピー',
  'consumer-missing': '利用側アプリ未作成で対象外',
  missing: '欠落',
  'content-mismatch': '内容不一致',
  'mount-mismatch': 'マウント不一致',
  'non-empty-node-modules': 'node_modulesの中身あり',
};

const CI_OR_MOUNT_GUIDANCE =
  'CIでは`bun run shared-dirs:place`を実行してください。ローカルではcompose.yamlで配置元が配置先へbind mountされているか確認してください。';

const PLACEMENTS: readonly Placement[] = SHARED_DIRS.flatMap(
  ({ source, mounts }) =>
    mounts.map(({ consumer, target }) => ({
      source,
      target,
      consumerDir: APPS.find((app) => app.name === consumer)?.dir,
    })),
);

// シンボリックリンクを辿り、リンク経由で配置元と同じ実体を指す配置先もコピー配置の書き込み対象から外せるようにする
export const readFileIdentity: FileIdentityReader = (path) => {
  const stats = statSync(path, { bigint: true, throwIfNoEntry: false });
  return stats === undefined ? undefined : { dev: stats.dev, ino: stats.ino };
};

// mountinfoはマウント先に含まれる空白・タブ・改行・バックスラッシュを3桁の8進数でエスケープして書く
const unescapeMountPath = (field: string): string =>
  field.replaceAll(/\\([0-7]{3})/g, (_escaped, octal: string) =>
    String.fromCodePoint(Number.parseInt(octal, 8)),
  );

export const readMountPoints = (
  mountinfoPath: string = MOUNTINFO_PATH,
): ReadonlySet<string> => {
  // mountinfoはLinuxにしか無く、bind mountで配置する開発コンテナはLinuxである。それ以外の環境は配置先をコピーで配置する前提のため、マウントポイントは無いものとして扱う
  if (!existsSync(mountinfoPath)) return new Set();
  return new Set(
    readFileSync(mountinfoPath, 'utf8')
      .split('\n')
      .flatMap((line) => {
        const field = line.split(' ')[MOUNT_POINT_FIELD_INDEX];
        return field === undefined ? [] : [unescapeMountPath(field)];
      }),
  );
};

// mountinfoのマウント先はシンボリックリンクを解決した実パスで書かれるため、配置先も実パスに直して比べる
export const isMountPoint = (
  path: string,
  mountPoints: ReadonlySet<string>,
): boolean => mountPoints.has(realpathSync(path));

const consumerExists = (repoRoot: string, { consumerDir }: Placement) =>
  consumerDir !== undefined &&
  existsSync(join(repoRoot, consumerDir, 'package.json'));

const pointsToSource = (
  sourcePath: string,
  targetPath: string,
  readIdentity: FileIdentityReader,
): boolean => {
  const source = readIdentity(sourcePath);
  const target = readIdentity(targetPath);
  return (
    source !== undefined &&
    target !== undefined &&
    source.dev === target.dev &&
    source.ino === target.ino
  );
};

const kindOf = (entry: Dirent): TreeEntry['kind'] | undefined => {
  if (entry.isDirectory()) return 'directory';
  if (entry.isFile()) return 'file';
  if (entry.isSymbolicLink()) return 'symlink';
  return undefined;
};

// node_modulesは配置の対象外のため、どの階層にあっても辿らない
const walkTree = (root: string, relativeDir = ''): readonly TreeEntry[] =>
  readdirSync(join(root, relativeDir), { withFileTypes: true })
    .filter((entry) => entry.name !== NODE_MODULES)
    .flatMap((entry): readonly TreeEntry[] => {
      const path = join(relativeDir, entry.name);
      const kind = kindOf(entry);
      if (kind === undefined) return [];
      return kind === 'directory'
        ? [{ path, kind }, ...walkTree(root, path)]
        : [{ path, kind }];
    });

// Git管理下のファイルを持たない配置元は新しいcloneに存在しないため、空のディレクトリとして扱う
const entriesOf = (root: string): readonly TreeEntry[] =>
  existsSync(root) ? walkTree(root) : [];

const listFiles = (root: string): readonly string[] =>
  entriesOf(root)
    .filter(({ kind }) => kind !== 'directory')
    .map(
      ({ path, kind }) =>
        `${kind} ${path} ${String(lstatSync(join(root, path)).size)}`,
    )
    .toSorted();

const sameFiles = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length &&
  left.every((line, index) => line === right[index]);

const hasNodeModulesContent = (targetPath: string): boolean => {
  const nodeModulesPath = join(targetPath, NODE_MODULES);
  return (
    statSync(nodeModulesPath, { throwIfNoEntry: false })?.isDirectory() ===
      true && readdirSync(nodeModulesPath).length > 0
  );
};

const inspectPlacement = (
  repoRoot: string,
  placement: Placement,
  readIdentity: FileIdentityReader,
  mountPoints: ReadonlySet<string>,
): PlacementState => {
  if (!consumerExists(repoRoot, placement)) return 'consumer-missing';
  const sourcePath = join(repoRoot, placement.source);
  const targetPath = join(repoRoot, placement.target);
  const targetStats = lstatSync(targetPath, { throwIfNoEntry: false });
  if (targetStats === undefined) return 'missing';
  if (targetStats.isSymbolicLink()) return 'content-mismatch';
  const sharesSource = pointsToSource(sourcePath, targetPath, readIdentity);
  // コピー配置はマウントポイントに書き込まないため、配置元以外のマウントはコピーの不一致と区別してcompose.yamlの確認へ案内する
  if (isMountPoint(targetPath, mountPoints) && !sharesSource) {
    return 'mount-mismatch';
  }
  if (!targetStats.isDirectory()) return 'content-mismatch';
  // 配置先のnode_modulesの中身は共有ディレクトリ側の依存として解決され二重実体になるため、bind mountでも問題とする
  if (hasNodeModulesContent(targetPath)) return 'non-empty-node-modules';
  if (sharesSource) return 'bind-mounted';
  return sameFiles(listFiles(sourcePath), listFiles(targetPath))
    ? 'copied'
    : 'content-mismatch';
};

export function inspectPlacements(
  repoRoot: string,
  readIdentity: FileIdentityReader = readFileIdentity,
  readMountPointSet: MountPointReader = readMountPoints,
): readonly PlacementReport[] {
  const mountPoints = readMountPointSet();
  return PLACEMENTS.map((placement) => ({
    source: placement.source,
    target: placement.target,
    state: inspectPlacement(repoRoot, placement, readIdentity, mountPoints),
  }));
}

// 配置先のnode_modulesはボリュームのマウント先のことがあり削除できないため、消さずに残して中身があれば報告する
const clearExceptNodeModules = (targetPath: string): void => {
  if (!lstatSync(targetPath).isDirectory()) {
    rmSync(targetPath);
    return;
  }
  for (const name of readdirSync(targetPath)) {
    if (name !== NODE_MODULES) {
      rmSync(join(targetPath, name), { recursive: true, force: true });
    }
  }
};

const copyEntry = (
  sourcePath: string,
  targetPath: string,
  { path, kind }: TreeEntry,
): void => {
  const from = join(sourcePath, path);
  const to = join(targetPath, path);
  if (kind === 'directory') {
    mkdirSync(to, { recursive: true });
  } else if (kind === 'file') {
    copyFileSync(from, to);
  } else {
    symlinkSync(readlinkSync(from), to);
  }
};

const copyTree = (sourcePath: string, targetPath: string): void => {
  mkdirSync(targetPath, { recursive: true });
  for (const entry of entriesOf(sourcePath)) {
    copyEntry(sourcePath, targetPath, entry);
  }
};

type CopyAction = 'create' | 'unlink' | 'replace' | 'keep';

// 削除はホスト側の実体や配置元を消し得るため、配置元と別の実体だと確かめられ、内容が一致しない配置先に限る
const copyActionFor = (
  sourcePath: string,
  targetPath: string,
  readIdentity: FileIdentityReader,
  mountPoints: ReadonlySet<string>,
): CopyAction => {
  const targetStats = lstatSync(targetPath, { throwIfNoEntry: false });
  if (targetStats === undefined) return 'create';
  if (targetStats.isSymbolicLink()) return 'unlink';
  // マウントポイントの中身はホスト側の実体であり、削除するとホストのファイルが消える
  if (isMountPoint(targetPath, mountPoints)) return 'keep';
  // 同一性を読めない配置先は、親ディレクトリのシンボリックリンクなどで配置元そのものである可能性を否定できない
  if (readIdentity(targetPath) === undefined) return 'keep';
  if (pointsToSource(sourcePath, targetPath, readIdentity)) return 'keep';
  const alreadyCopied =
    targetStats.isDirectory() &&
    sameFiles(listFiles(sourcePath), listFiles(targetPath));
  return alreadyCopied ? 'keep' : 'replace';
};

const placeOne = (
  sourcePath: string,
  targetPath: string,
  action: CopyAction,
): void => {
  if (action === 'keep') return;
  // リンク先(配置元やマウントポイントのこともある)は辿らず、リンク自体だけを削除する
  if (action === 'unlink') unlinkSync(targetPath);
  if (action === 'replace') clearExceptNodeModules(targetPath);
  copyTree(sourcePath, targetPath);
};

export function placeByCopy(
  repoRoot: string,
  readIdentity: FileIdentityReader = readFileIdentity,
  readMountPointSet: MountPointReader = readMountPoints,
): readonly PlacementReport[] {
  const mountPoints = readMountPointSet();
  for (const placement of PLACEMENTS) {
    if (!consumerExists(repoRoot, placement)) continue;
    const sourcePath = join(repoRoot, placement.source);
    const targetPath = join(repoRoot, placement.target);
    placeOne(
      sourcePath,
      targetPath,
      copyActionFor(sourcePath, targetPath, readIdentity, mountPoints),
    );
  }
  return inspectPlacements(repoRoot, readIdentity, readMountPointSet);
}

export function describeProblem(report: PlacementReport): string | undefined {
  switch (report.state) {
    case 'missing':
      return `${report.target}がありません。${CI_OR_MOUNT_GUIDANCE}`;
    case 'content-mismatch':
      return `${report.target}の内容が${report.source}と一致しません。${CI_OR_MOUNT_GUIDANCE}`;
    case 'mount-mismatch':
      return `${report.target}はマウントポイントですが、${report.source}と同じ実体であることを確認できません。\`bun run shared-dirs:place\`もマウントポイントには書き込まないため、compose.yamlで${report.source}が${report.target}へbind mountされているか確認し、修正後にコンテナを再作成してください(ホストで\`docker compose up -d\`を実行する)。`;
    case 'non-empty-node-modules':
      return `${report.target}/node_modulesに中身があり、共有ディレクトリと利用側アプリで同じパッケージが別々の実体として読み込まれます。compose.yamlの変更後にコンテナを再作成してください(ホストで\`docker compose up -d\`を実行する)。`;
    case 'bind-mounted':
    case 'copied':
    case 'consumer-missing':
      return undefined;
  }
}

const padToWidth = (text: string, width: number): string =>
  `${text}${' '.repeat(width - Bun.stringWidth(text))}`;

export function formatPlacementTable(
  reports: readonly PlacementReport[],
): string {
  const rows: readonly (readonly [string, string, string])[] = [
    ['配置元', '配置先', '状態'],
    ...reports.map(
      ({ source, target, state }) =>
        [source, target, `${STATE_LABELS[state]}(${state})`] as const,
    ),
  ];
  const sourceWidth = Math.max(
    ...rows.map(([source]) => Bun.stringWidth(source)),
  );
  const targetWidth = Math.max(
    ...rows.map(([, target]) => Bun.stringWidth(target)),
  );
  return rows
    .map(
      ([source, target, state]) =>
        `${padToWidth(source, sourceWidth)}  ${padToWidth(target, targetWidth)}  ${state}\n`,
    )
    .join('');
}

const MODES = {
  verify: {
    run: inspectPlacements,
    failure: '共有ディレクトリの配置状態を確認できませんでした',
  },
  place: {
    run: placeByCopy,
    failure: '共有ディレクトリをコピーで配置できませんでした',
  },
} as const;

type Mode = keyof typeof MODES;

const USAGE = [
  '使い方: bun scripts/tooling/shared-dirs.ts <verify|place>',
  '  verify: 共有ディレクトリの配置状態を確認する',
  '  place: bind mountされていない配置先へ共有ディレクトリをコピーで配置し、配置状態を確認する',
  '',
].join('\n');

const isMode = (value: string): value is Mode => Object.hasOwn(MODES, value);

const parseMode = (args: readonly string[]): Mode | undefined => {
  const [mode] = args;
  return args.length === 1 && mode !== undefined && isMode(mode)
    ? mode
    : undefined;
};

const formatProblems = (problems: readonly string[]): string =>
  [
    `共有ディレクトリの配置に問題が${String(problems.length)}件あります。`,
    ...problems.map((problem) => `  ${problem}`),
    '',
  ].join('\n');

export function runSharedDirsEntry({
  args,
  repoRoot,
  stdout,
  stderr,
}: SharedDirsEntryDependencies): number {
  const mode = parseMode(args);
  if (mode === undefined) {
    stderr.write(USAGE);
    return 1;
  }
  try {
    const reports = MODES[mode].run(repoRoot);
    stdout.write(formatPlacementTable(reports));
    const problems = reports.flatMap((report) => {
      const problem = describeProblem(report);
      return problem === undefined ? [] : [problem];
    });
    if (problems.length === 0) {
      stdout.write('共有ディレクトリの配置に問題はありません。\n');
      return 0;
    }
    stderr.write(formatProblems(problems));
    return 1;
  } catch (error) {
    stderr.write(
      `${MODES[mode].failure}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = runSharedDirsEntry({
    args: process.argv.slice(2),
    // サブディレクトリで実行すると利用側アプリが見つからず全配置先が対象外として成功してしまうため、カレントディレクトリではなくこのスクリプトを含むリポジトリを対象にする
    repoRoot: resolve(import.meta.dirname, '..', '..'),
    stdout: process.stdout,
    stderr: process.stderr,
  });
}
