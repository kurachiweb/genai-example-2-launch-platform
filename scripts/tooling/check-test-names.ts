import {
  TEST_FILE_PATTERNS,
  TEST_LIKE_FILE_PATTERN,
  type TestKind,
} from '../../config/test-patterns.ts';
import {
  EXTERNAL_SOURCE_DIRS,
  QUALITY_GATE_EXCLUDED_DIRS,
} from '../../config/workspace-layout.ts';

export interface MisnamedTestFile {
  readonly path: string;
  readonly expected: readonly string[];
}

export interface GitCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type GitRunner = (
  args: readonly string[],
  cwd: string,
) => GitCommandResult;

interface TextOutput {
  readonly write: (text: string) => unknown;
}

export interface TestNameCheckEntryDependencies {
  readonly cwd: string;
  readonly runGit: GitRunner;
  readonly stdout: TextOutput;
  readonly stderr: TextOutput;
}

const TEST_KIND_LABELS: Readonly<Record<TestKind, string>> = {
  unit: '単体テスト',
  browser: 'ブラウザテスト',
  worker: 'Workers統合テスト',
  e2e: 'E2Eテスト',
};

const TEST_KINDS = Object.keys(TEST_FILE_PATTERNS) as readonly TestKind[];

const NAMING_PATTERNS: readonly string[] = TEST_KINDS.flatMap(
  (kind) => TEST_FILE_PATTERNS[kind],
);

const NAMING_GLOBS = NAMING_PATTERNS.map((pattern) => new Bun.Glob(pattern));

const OUT_OF_SCOPE_DIRS = [
  ...QUALITY_GATE_EXCLUDED_DIRS,
  ...EXTERNAL_SOURCE_DIRS,
];

const LS_FILES_ARGS = [
  'ls-files',
  '--cached',
  '--others',
  '--exclude-standard',
  '-z',
];

const isUnder = (path: string, dir: string): boolean =>
  path.startsWith(`${dir}/`);

const followsNamingConvention = (path: string): boolean =>
  NAMING_GLOBS.some((glob) => glob.match(path));

export function findMisnamedTestFiles(
  repoRelativePaths: readonly string[],
): readonly MisnamedTestFile[] {
  return repoRelativePaths
    .filter(
      (path) =>
        TEST_LIKE_FILE_PATTERN.test(path) && !followsNamingConvention(path),
    )
    .map((path) => ({ path, expected: NAMING_PATTERNS }));
}

export function selectCheckTargets(
  repoRelativePaths: readonly string[],
): readonly string[] {
  return repoRelativePaths.filter(
    (path) => !OUT_OF_SCOPE_DIRS.some((dir) => isUnder(path, dir)),
  );
}

const describeConvention = (pattern: string): string => {
  const kind = TEST_KINDS.find((candidate) =>
    TEST_FILE_PATTERNS[candidate].includes(pattern),
  );
  return kind === undefined ? pattern : `${TEST_KIND_LABELS[kind]}: ${pattern}`;
};

export function formatMisnamedTestFiles(
  misnamed: readonly MisnamedTestFile[],
): string {
  const conventions = [
    ...new Set(misnamed.flatMap(({ expected }) => expected)),
  ];
  return [
    `命名規約に一致しないテストファイルが${String(misnamed.length)}件あります。`,
    ...misnamed.map(({ path }) => `  ${path}`),
    'テストの種別に合わせて、次のいずれかの命名規約に従う名前へ変更してください。',
    ...conventions.map((pattern) => `  ${describeConvention(pattern)}`),
    '',
  ].join('\n');
}

const runGitOrThrow = (
  runGit: GitRunner,
  args: readonly string[],
  cwd: string,
): string => {
  const { exitCode, stdout, stderr } = runGit(args, cwd);
  if (exitCode !== 0) {
    throw new Error(
      `Gitのファイル一覧を取得できませんでした(git ${args.join(' ')}): ${stderr.trim()}`,
    );
  }
  return stdout;
};

// サブディレクトリで実行するとgit ls-filesはその配下だけを相対パスで返すため、作業ツリーのルートで実行してリポジトリ全体をルートからのパスで得る
export function listRepositoryFiles(
  cwd: string,
  runGit: GitRunner,
): readonly string[] {
  const repoRoot = runGitOrThrow(
    runGit,
    ['rev-parse', '--show-toplevel'],
    cwd,
  ).trimEnd();
  const paths = runGitOrThrow(runGit, LS_FILES_ARGS, repoRoot)
    .split('\0')
    .filter((path) => path !== '');
  // git ls-filesは未追跡・管理対象の順に出力し、マージの競合中は同じパスを段階ごとに重複して出力する
  return [...new Set(paths)].toSorted();
}

export const spawnGit: GitRunner = (args, cwd) => {
  const { exitCode, stdout, stderr } = Bun.spawnSync(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return { exitCode, stdout: stdout.toString(), stderr: stderr.toString() };
};

export function runTestNameCheckEntry({
  cwd,
  runGit,
  stdout,
  stderr,
}: TestNameCheckEntryDependencies): number {
  try {
    const misnamed = findMisnamedTestFiles(
      selectCheckTargets(listRepositoryFiles(cwd, runGit)),
    );
    if (misnamed.length === 0) {
      stdout.write('命名規約に一致しないテストファイルはありません。\n');
      return 0;
    }
    stderr.write(formatMisnamedTestFiles(misnamed));
    return 1;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = runTestNameCheckEntry({
    cwd: process.cwd(),
    runGit: spawnGit,
    stdout: process.stdout,
    stderr: process.stderr,
  });
}
