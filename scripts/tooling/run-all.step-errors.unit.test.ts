import { describe, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  ALL_DIRS,
  callOf,
  createFakeWorkspace,
  createOutput,
  everyDirWith,
  failedWith,
  packageJsonOf,
  PASSED,
  PROJECT_MISSING,
  resultsOf,
  ROOT_CHECK_SCRIPTS,
  ROOT_DIR,
  runEntry,
  runEntryInProcess,
  scriptsOf,
  SPAWN_TIMEOUT_MS,
  useRunAllFixtures,
} from '../../test-support/run-all-fixtures.ts';
import { writeFixtureFiles } from '../../test-support/shared-dirs-fixtures.ts';
import {
  exitCodeOf,
  formatFailureCauses,
  formatSummary,
  readPackageScripts,
  runAggregate,
  runAggregateEntry,
  type StepOutcome,
  type StepResult,
} from './run-all.ts';

const { createDir, createRepositoryWithScript } = useRunAllFixtures();

const PARSE_ERROR = 'JSON Parse error: Unexpected EOF';
const NOT_AN_OBJECT = '最上位の値がオブジェクトではありません';
const SCRIPTS_NOT_STRINGS =
  'scriptsが、値がすべて文字列のオブジェクトではありません';
const SPAWN_ERROR = 'Executable not found in $PATH: "bun"';

const unreadableEventOf = (reason: string): string =>
  `apps/event/package.jsonを読み込めませんでした: ${reason}`;

const unreadablePackage = (detail: string): StepOutcome => ({
  status: 'failed',
  exitCode: 1,
  cause: { reason: 'package-json-unreadable', detail },
});

const unrunnableCommand = (detail: string): StepOutcome => ({
  status: 'failed',
  exitCode: 1,
  cause: { reason: 'command-unrunnable', detail },
});

const causesMessageOf = (...details: readonly string[]): string =>
  [
    `スクリプトを実行できなかった原因が${String(details.length)}件あります。`,
    ...details.map((detail) => `  ${detail}`),
    '',
  ].join('\n');

const CHECK_WORKSPACE = {
  ...everyDirWith('lint', 'typecheck'),
  [ROOT_DIR]: scriptsOf(...ROOT_CHECK_SCRIPTS),
};

const ROOT_STEPS_PASSED: readonly StepResult[] = [
  { step: 'shared-dirs:verify', target: 'root', outcome: PASSED },
  { step: 'check:test-names', target: 'root', outcome: PASSED },
  { step: 'format:check', target: 'root', outcome: PASSED },
];

const UNREADABLE_EVENT = unreadablePackage(unreadableEventOf(PARSE_ERROR));

const CHECK_RESULTS_WITH_UNREADABLE_EVENT: readonly StepResult[] = [
  ...ROOT_STEPS_PASSED,
  ...resultsOf('lint', { api: failedWith(3), event: UNREADABLE_EVENT }, PASSED),
  ...resultsOf('typecheck', { event: UNREADABLE_EVENT }, PASSED),
];

const createWorkspaceWithUnreadableEvent = () =>
  createFakeWorkspace(
    { ...CHECK_WORKSPACE, 'apps/event': new Error(PARSE_ERROR) },
    { 'apps/api lint': 3 },
  );

const DIRS_EXCEPT_EVENT = ALL_DIRS.filter((dir) => dir !== 'apps/event');

describe('runAggregate', () => {
  test('package.jsonを読めないアプリは、各段階の失敗としてパス付きの原因と共に記録し、後続の対象と段階を続ける', async () => {
    const { deps, calls } = createWorkspaceWithUnreadableEvent();

    const results = await runAggregate('check', [], deps);

    expect(calls).toEqual([
      callOf(ROOT_DIR, 'bun', 'run', 'shared-dirs:verify'),
      callOf(ROOT_DIR, 'bun', 'run', 'check:test-names'),
      callOf(ROOT_DIR, 'bun', 'run', 'format:check'),
      ...DIRS_EXCEPT_EVENT.map((dir) => callOf(dir, 'bun', 'run', 'lint')),
      ...DIRS_EXCEPT_EVENT.map((dir) => callOf(dir, 'bun', 'run', 'typecheck')),
    ]);
    expect(results).toEqual(CHECK_RESULTS_WITH_UNREADABLE_EVENT);
    expect(exitCodeOf(results)).toBe(1);
  });

  test('ルートのpackage.jsonを読めなければリポジトリ直下のパスを原因に示し、各アプリのテストを続ける', async () => {
    const { deps, calls } = createFakeWorkspace({
      ...everyDirWith('test:unit'),
      [ROOT_DIR]: new Error(NOT_AN_OBJECT),
    });

    const results = await runAggregate('test:unit', ['--coverage'], deps);

    expect(calls).toEqual(
      ALL_DIRS.filter((dir) => dir !== ROOT_DIR).map((dir) =>
        callOf(dir, 'bun', 'run', 'test:unit', '--coverage'),
      ),
    );
    expect(results).toEqual(
      resultsOf(
        'test:unit',
        {
          root: unreadablePackage(
            `package.jsonを読み込めませんでした: ${NOT_AN_OBJECT}`,
          ),
        },
        PASSED,
      ),
    );
  });

  test('コマンドを起動できなかった対象は、失敗として実行場所とコマンド付きの原因と共に記録し、後続の対象を続ける', async () => {
    const spawnError = new Error(SPAWN_ERROR);
    const { deps, calls } = createFakeWorkspace(everyDirWith('lint'), {
      '. lint': spawnError,
      'apps/api lint': spawnError,
    });

    const results = await runAggregate('lint', ['--max-warnings=0'], deps);

    expect(calls).toHaveLength(ALL_DIRS.length);
    expect(results).toEqual(
      resultsOf(
        'lint',
        {
          root: unrunnableCommand(
            `ルートで\`bun run lint --max-warnings=0\`を実行できませんでした: ${SPAWN_ERROR}`,
          ),
          api: unrunnableCommand(
            `apps/apiで\`bun run lint --max-warnings=0\`を実行できませんでした: ${SPAWN_ERROR}`,
          ),
        },
        PASSED,
      ),
    );
  });
});

describe('readPackageScripts', () => {
  test.each<[string, string, string]>([
    ['不正なJSON', '{"scripts":', PARSE_ERROR],
    ['最上位がnull', 'null\n', NOT_AN_OBJECT],
    ['最上位が配列', '[]\n', NOT_AN_OBJECT],
    ['scriptsが文字列', '{"scripts":"eslint ."}\n', SCRIPTS_NOT_STRINGS],
    ['scriptsがnull', '{"scripts":null}\n', SCRIPTS_NOT_STRINGS],
    ['scriptsが配列', '{"scripts":["lint"]}\n', SCRIPTS_NOT_STRINGS],
    [
      'scriptsの値が文字列でない',
      '{"scripts":{"lint":1}}\n',
      SCRIPTS_NOT_STRINGS,
    ],
  ])(
    '%sのpackage.jsonを読むと、理由を示す例外を投げる',
    async (_kind, content, reason) => {
      const dir = await createDir('invalid-package-');
      await writeFixtureFiles(dir, { 'package.json': content });

      expect(() => readPackageScripts(dir)).toThrow(reason);
    },
  );

  test('package.jsonがディレクトリなら、読み込みの例外を投げる', async () => {
    const dir = await createDir('directory-package-');
    await mkdir(join(dir, 'package.json'));

    expect(() => readPackageScripts(dir)).toThrow('EISDIR');
  });
});

describe('formatSummary', () => {
  test('スクリプトを実行できずに失敗した対象は、結果欄に終了コードではなく理由を表示し、失敗として数える', () => {
    const summary = formatSummary([
      { step: 'lint', target: 'event', outcome: UNREADABLE_EVENT },
      {
        step: 'lint',
        target: 'api',
        outcome: unrunnableCommand(
          'apps/apiで`bun run lint`を実行できませんでした',
        ),
      },
      { step: 'lint', target: 'root', outcome: failedWith(2) },
    ]);

    expect(
      summary
        .split('\n')
        .slice(1, -1)
        .map((line) => line.split(/ {2,}/)),
    ).toEqual([
      ['静的解析(lint)', 'event', '失敗(package.jsonを読めない)'],
      ['静的解析(lint)', 'api', '失敗(コマンドを実行できない)'],
      ['静的解析(lint)', 'ルート', '失敗(終了コード2)'],
      ['成功0件・失敗3件・飛ばした0件'],
    ]);
  });
});

describe('formatFailureCauses', () => {
  test('原因付きの失敗を、同じ原因の重複を除いて件数と共に1行ずつ示す', () => {
    const unrunnable = `apps/apiで\`bun run lint\`を実行できませんでした: ${SPAWN_ERROR}`;

    expect(
      formatFailureCauses([
        { step: 'lint', target: 'root', outcome: failedWith(2) },
        { step: 'lint', target: 'api', outcome: unrunnableCommand(unrunnable) },
        { step: 'lint', target: 'event', outcome: UNREADABLE_EVENT },
        { step: 'typecheck', target: 'root', outcome: PASSED },
        { step: 'typecheck', target: 'event', outcome: UNREADABLE_EVENT },
      ]),
    ).toBe(causesMessageOf(unrunnable, unreadableEventOf(PARSE_ERROR)));
  });

  test('原因付きの失敗が無ければ何も示さない', () => {
    expect(
      formatFailureCauses([
        { step: 'lint', target: 'root', outcome: failedWith(2) },
        { step: 'lint', target: 'api', outcome: PROJECT_MISSING },
      ]),
    ).toBe('');
  });
});

describe('runAggregateEntry', () => {
  test('package.jsonを読めないアプリがあっても全段階を実行し、結果の表に続けてパス付きの原因を示して1を返す', async () => {
    const { deps, calls } = createWorkspaceWithUnreadableEvent();

    const { exitCode, stdout, stderr } = await runEntryInProcess(
      ['check'],
      deps,
    );

    expect(calls).toHaveLength(3 + DIRS_EXCEPT_EVENT.length * 2);
    expect(stdout).toBe(
      `\n${formatSummary(CHECK_RESULTS_WITH_UNREADABLE_EVENT)}`,
    );
    expect(stderr).toBe(causesMessageOf(unreadableEventOf(PARSE_ERROR)));
    expect(exitCode).toBe(1);
  });

  test('結果の表示中に想定外の例外が起きれば、理由を示して1を返す', async () => {
    const { deps } = createFakeWorkspace(everyDirWith('lint'));
    const stderr = createOutput();

    const exitCode = await runAggregateEntry({
      ...deps,
      args: ['lint'],
      stdout: {
        write: () => {
          throw new Error('EPIPE: broken pipe, write');
        },
      },
      stderr,
    });

    expect(stderr.text()).toBe(
      '一括実行を完了できませんでした: EPIPE: broken pipe, write\n',
    );
    expect(exitCode).toBe(1);
  });
});

describe('直接実行したときの入口', () => {
  test.each<[string, Readonly<Record<string, string>>, string]>([
    ['不正なJSON', { 'apps/event/package.json': '{"scripts":' }, PARSE_ERROR],
    ['最上位がnull', { 'apps/event/package.json': 'null\n' }, NOT_AN_OBJECT],
    [
      'scriptsが文字列',
      { 'apps/event/package.json': '{"scripts":"lint"}\n' },
      SCRIPTS_NOT_STRINGS,
    ],
    [
      'ディレクトリ',
      { 'apps/event/package.json/.gitkeep': '' },
      'EISDIR: illegal operation on a directory, read',
    ],
  ])(
    'apps/event/package.jsonが「%s」でも、checkは全段階・全対象を実行し、結果の表と理由付きのパスを示して1で終える',
    async (_kind, eventFiles, reason) => {
      const repoRoot = await createRepositoryWithScript({
        'package.json': packageJsonOf({
          'shared-dirs:verify': 'echo verify',
          'check:test-names': 'echo names',
          'format:check': 'echo format',
          lint: 'echo lint-root',
          typecheck: 'echo typecheck-root',
        }),
        'apps/api/package.json': packageJsonOf({
          lint: 'exit 3',
          typecheck: 'echo typecheck-api',
        }),
        'apps/frontend-lib/package.json': packageJsonOf({
          lint: 'echo lint-frontend-lib',
          typecheck: 'echo typecheck-frontend-lib',
        }),
        ...eventFiles,
      });
      const unreadable = unreadablePackage(unreadableEventOf(reason));

      const { exitCode, stdout, stderr } = runEntry(repoRoot, ['check']);

      expect(stdout).toContain('\nlint-frontend-lib\n');
      expect(stdout).toContain('\ntypecheck-frontend-lib\n');
      expect(stdout).toEndWith(
        formatSummary([
          ...ROOT_STEPS_PASSED,
          ...resultsOf(
            'lint',
            {
              root: PASSED,
              api: failedWith(3),
              event: unreadable,
              'frontend-lib': PASSED,
            },
            PROJECT_MISSING,
          ),
          ...resultsOf(
            'typecheck',
            {
              root: PASSED,
              api: PASSED,
              event: unreadable,
              'frontend-lib': PASSED,
            },
            PROJECT_MISSING,
          ),
        ]),
      );
      expect(stderr).toEndWith(causesMessageOf(unreadableEventOf(reason)));
      expect(exitCode).toBe(1);
    },
    SPAWN_TIMEOUT_MS,
  );
});
