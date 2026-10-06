import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
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
  REPO_ROOT,
  resultsOf,
  ROOT_CHECK_SCRIPTS,
  ROOT_DIR,
  runEntry,
  runEntryInProcess,
  SCRIPT_MISSING,
  scriptsOf,
  SPAWN_TIMEOUT_MS,
  useRunAllFixtures,
} from '../../test-support/run-all-fixtures.ts';
import { writeFixtureFiles } from '../../test-support/shared-dirs-fixtures.ts';
import {
  type AggregateCommand,
  type AggregateDependencies,
  createSpawnRunner,
  exitCodeOf,
  formatSummary,
  readPackageScripts,
  runAggregate,
  type StepResult,
} from './run-all.ts';

const USAGE_MESSAGE = [
  '使い方: bun scripts/tooling/run-all.ts <check|lint|typecheck|test:unit|test:browser|test:worker> [引数...]',
  '  check: 共有ディレクトリの配置確認・テスト命名の検査・整形検査・静的解析・型検査を、失敗しても止めずにすべて実行する(引数は受け取らない)',
  '  それ以外: ルートと各アプリの同名スクリプトを、残りの引数付きで実行する',
  '',
].join('\n');

const { createDir, createRepositoryWithScript } = useRunAllFixtures();

describe('runAggregate', () => {
  test('checkは配置確認・命名検査・整形検査をルートで、静的解析と型検査をルートと各アプリで、この順に実行する', async () => {
    const { deps, calls } = createFakeWorkspace({
      ...everyDirWith('lint', 'typecheck'),
      [ROOT_DIR]: scriptsOf(...ROOT_CHECK_SCRIPTS),
    });

    const results = await runAggregate('check', [], deps);

    expect(calls).toEqual([
      callOf(ROOT_DIR, 'bun', 'run', 'shared-dirs:verify'),
      callOf(ROOT_DIR, 'bun', 'run', 'check:test-names'),
      callOf(ROOT_DIR, 'bun', 'run', 'format:check'),
      ...ALL_DIRS.map((dir) => callOf(dir, 'bun', 'run', 'lint')),
      ...ALL_DIRS.map((dir) => callOf(dir, 'bun', 'run', 'typecheck')),
    ]);
    expect(results).toEqual([
      { step: 'shared-dirs:verify', target: 'root', outcome: PASSED },
      { step: 'check:test-names', target: 'root', outcome: PASSED },
      { step: 'format:check', target: 'root', outcome: PASSED },
      ...resultsOf('lint', {}, PASSED),
      ...resultsOf('typecheck', {}, PASSED),
    ]);
  });

  test('checkは前段や他の対象が失敗しても後続の段階と対象をすべて実行し、失敗を終了コード付きで残す', async () => {
    const { deps, calls } = createFakeWorkspace(
      {
        ...everyDirWith('lint', 'typecheck'),
        [ROOT_DIR]: scriptsOf(...ROOT_CHECK_SCRIPTS),
      },
      { '. shared-dirs:verify': 1, 'apps/api lint': 2, '. typecheck': 2 },
    );

    const results = await runAggregate('check', [], deps);

    expect(calls).toHaveLength(3 + ALL_DIRS.length * 2);
    expect(results).toEqual([
      { step: 'shared-dirs:verify', target: 'root', outcome: failedWith(1) },
      { step: 'check:test-names', target: 'root', outcome: PASSED },
      { step: 'format:check', target: 'root', outcome: PASSED },
      ...resultsOf('lint', { api: failedWith(2) }, PASSED),
      ...resultsOf('typecheck', { root: failedWith(2) }, PASSED),
    ]);
  });

  test('package.jsonが無いアプリはproject-missing、スクリプトが無い対象はscript-missingとして飛ばし、コマンドを実行しない', async () => {
    const { deps, calls } = createFakeWorkspace({
      [ROOT_DIR]: scriptsOf('shared-dirs:verify', 'format:check', 'lint'),
      'apps/api': scriptsOf('lint'),
      'apps/client': {},
    });

    const results = await runAggregate('check', [], deps);

    expect(calls).toEqual([
      callOf(ROOT_DIR, 'bun', 'run', 'shared-dirs:verify'),
      callOf(ROOT_DIR, 'bun', 'run', 'format:check'),
      callOf(ROOT_DIR, 'bun', 'run', 'lint'),
      callOf('apps/api', 'bun', 'run', 'lint'),
    ]);
    expect(results).toEqual([
      { step: 'shared-dirs:verify', target: 'root', outcome: PASSED },
      { step: 'check:test-names', target: 'root', outcome: SCRIPT_MISSING },
      { step: 'format:check', target: 'root', outcome: PASSED },
      ...resultsOf(
        'lint',
        { root: PASSED, api: PASSED, client: SCRIPT_MISSING },
        PROJECT_MISSING,
      ),
      ...resultsOf(
        'typecheck',
        { root: SCRIPT_MISSING, api: SCRIPT_MISSING, client: SCRIPT_MISSING },
        PROJECT_MISSING,
      ),
    ]);
  });

  test('テスト種別の一括実行は、ルートと各アプリの同名スクリプトを、渡された引数付きで実行する', async () => {
    const { deps, calls } = createFakeWorkspace({
      [ROOT_DIR]: scriptsOf('test:unit'),
      'apps/api': scriptsOf('test:unit'),
      'apps/frontend-lib': scriptsOf('test:unit', 'test:browser'),
    });

    const results = await runAggregate(
      'test:unit',
      ['--coverage', '--bail'],
      deps,
    );

    expect(calls).toEqual(
      [ROOT_DIR, 'apps/api', 'apps/frontend-lib'].map((dir) =>
        callOf(dir, 'bun', 'run', 'test:unit', '--coverage', '--bail'),
      ),
    );
    expect(results).toEqual(
      resultsOf(
        'test:unit',
        { root: PASSED, api: PASSED, 'frontend-lib': PASSED },
        PROJECT_MISSING,
      ),
    );
  });

  test('ルートにスクリプトが無く、アプリも未作成のテスト種別は、すべて飛ばして失敗にしない', async () => {
    const { deps, calls } = createFakeWorkspace({
      [ROOT_DIR]: scriptsOf('test:unit'),
    });

    const results = await runAggregate('test:browser', ['--coverage'], deps);

    expect(calls).toEqual([]);
    expect(results).toEqual(
      resultsOf('test:browser', { root: SCRIPT_MISSING }, PROJECT_MISSING),
    );
    expect(exitCodeOf(results)).toBe(0);
  });

  test('静的解析や型検査を単独で指定すると、その検査だけをルートと各アプリで引数付きで実行する', async () => {
    const { deps, calls } = createFakeWorkspace(everyDirWith('lint'));

    const results = await runAggregate('lint', ['--max-warnings=0'], deps);

    expect(calls).toEqual(
      ALL_DIRS.map((dir) =>
        callOf(dir, 'bun', 'run', 'lint', '--max-warnings=0'),
      ),
    );
    expect(results).toEqual(resultsOf('lint', {}, PASSED));
  });

  test('checkの各段階には引数を渡さない', async () => {
    const { deps, calls } = createFakeWorkspace({
      [ROOT_DIR]: scriptsOf(...ROOT_CHECK_SCRIPTS),
    });

    await runAggregate('check', ['--fix'], deps);

    expect(calls.map(({ command }) => command)).toEqual(
      ROOT_CHECK_SCRIPTS.map((script) => ['bun', 'run', script]),
    );
  });
});

describe('exitCodeOf', () => {
  test('成功と飛ばした対象だけなら0を返す', () => {
    expect(
      exitCodeOf([
        { step: 'lint', target: 'root', outcome: PASSED },
        { step: 'lint', target: 'api', outcome: PROJECT_MISSING },
        { step: 'lint', target: 'event', outcome: SCRIPT_MISSING },
      ]),
    ).toBe(0);
  });

  test('1つでも失敗があれば1を返す', () => {
    expect(
      exitCodeOf([
        { step: 'lint', target: 'root', outcome: PASSED },
        { step: 'typecheck', target: 'api', outcome: failedWith(2) },
      ]),
    ).toBe(1);
  });

  test('対象が無ければ0を返す', () => {
    expect(exitCodeOf([])).toBe(0);
  });
});

describe('formatSummary', () => {
  const RESULTS: readonly StepResult[] = [
    { step: 'shared-dirs:verify', target: 'root', outcome: PASSED },
    { step: 'lint', target: 'api', outcome: failedWith(2) },
    { step: 'typecheck', target: 'frontend-lib', outcome: PROJECT_MISSING },
    { step: 'test:unit', target: 'admin', outcome: SCRIPT_MISSING },
    { step: 'custom', target: 'client', outcome: PASSED },
  ];

  const linesOf = (summary: string): readonly string[] =>
    summary.split('\n').slice(0, -1);

  const tableLinesOf = (summary: string): readonly string[] =>
    linesOf(summary).slice(0, -1);

  test('段階・対象・結果の表と、結果ごとの件数を表示する', () => {
    const lines = linesOf(formatSummary(RESULTS));

    expect(lines.map((line) => line.split(/ {2,}/))).toEqual([
      ['段階', '対象', '結果'],
      ['共有ディレクトリの配置確認(shared-dirs:verify)', 'ルート', '成功'],
      ['静的解析(lint)', 'api', '失敗(終了コード2)'],
      ['型検査(typecheck)', 'frontend-lib', '飛ばした(プロジェクト未作成)'],
      ['単体テスト(test:unit)', 'admin', '飛ばした(スクリプト未定義)'],
      ['custom', 'client', '成功'],
      ['成功2件・失敗1件・飛ばした2件'],
    ]);
  });

  test('全角文字を含む列も表示幅で桁をそろえ、行末に空白を残さない', () => {
    const lines = tableLinesOf(formatSummary(RESULTS));
    const columnStartsOf = (line: string): readonly number[] => {
      const [, target = '', outcome = ''] = line.split(/ {2,}/);
      return [
        Bun.stringWidth(line.slice(0, line.indexOf(`  ${target}`) + 2)),
        Bun.stringWidth(line.slice(0, line.lastIndexOf(`  ${outcome}`) + 2)),
      ];
    };

    const [header = '', ...rows] = lines;

    expect(rows.map(columnStartsOf)).toEqual(
      rows.map(() => columnStartsOf(header)),
    );
    expect(columnStartsOf(header)).toEqual([48, 62]);
    expect(lines.filter((line) => line !== line.trimEnd())).toEqual([]);
  });

  test('一括検査の他の段階とテスト種別にもラベルを付ける', () => {
    const steps = [
      'check:test-names',
      'format:check',
      'test:browser',
      'test:worker',
    ];

    const lines = tableLinesOf(
      formatSummary(
        steps.map((step) => ({ step, target: 'root', outcome: PASSED })),
      ),
    );

    expect(lines.slice(1).map((line) => line.split(/ {2,}/)[0])).toEqual([
      'テスト命名の検査(check:test-names)',
      '整形検査(format:check)',
      'ブラウザテスト(test:browser)',
      'Workers統合テスト(test:worker)',
    ]);
  });

  test('対象が無ければ見出しだけの表と、すべて0件の件数を表示する', () => {
    expect(linesOf(formatSummary([]))).toEqual([
      '段階  対象  結果',
      '成功0件・失敗0件・飛ばした0件',
    ]);
  });
});

describe('readPackageScripts', () => {
  test('package.jsonが無ければundefinedを返す', async () => {
    const dir = await createDir('no-package-');

    expect(readPackageScripts(dir)).toBeUndefined();
  });

  test('package.jsonのscriptsを返し、scriptsが無ければ空のオブジェクトを返す', async () => {
    const dir = await createDir('package-');
    await writeFixtureFiles(dir, {
      'package.json': `${JSON.stringify({ scripts: { lint: 'eslint .' } })}\n`,
      'empty/package.json': '{"name":"empty"}\n',
    });

    expect(readPackageScripts(dir)).toEqual({ lint: 'eslint .' });
    expect(readPackageScripts(join(dir, 'empty'))).toEqual({});
  });
});

describe('createSpawnRunner', () => {
  test(
    'コマンドを指定したディレクトリで実行し、実行するディレクトリとコマンドを表示して終了コードを返す',
    async () => {
      const repoRoot = await createDir('spawn-');
      await mkdir(join(repoRoot, 'apps/api'), { recursive: true });
      const output = createOutput();
      const runner = createSpawnRunner(repoRoot, output);

      const appExitCode = await runner.run(
        ['sh', '-c', 'touch ran-here; exit 3'],
        join(repoRoot, 'apps/api'),
      );
      const rootExitCode = await runner.run(['true'], repoRoot);

      expect(appExitCode).toBe(3);
      expect(rootExitCode).toBe(0);
      expect(existsSync(join(repoRoot, 'apps/api/ran-here'))).toBe(true);
      expect(output.text()).toBe(
        '\n▶ apps/api: sh -c touch ran-here; exit 3\n\n▶ ルート: true\n',
      );
    },
    SPAWN_TIMEOUT_MS,
  );
});

describe('runAggregateEntry', () => {
  test.each<[readonly string[]]>([[[]], [['deploy']], [['check', '--fix']]])(
    '引数が%pなら使い方を表示して1を返し、何も実行しない',
    async (args) => {
      const { deps, calls } = createFakeWorkspace(everyDirWith('lint'));

      const { exitCode, stdout, stderr } = await runEntryInProcess(args, deps);

      expect(stderr).toBe(USAGE_MESSAGE);
      expect(stdout).toBe('');
      expect(exitCode).toBe(1);
      expect(calls).toEqual([]);
    },
  );

  test('checkを実行し、結果の表を表示して、失敗があれば1を返す', async () => {
    const { deps } = createFakeWorkspace(
      { [ROOT_DIR]: scriptsOf(...ROOT_CHECK_SCRIPTS) },
      { '. format:check': 1 },
    );

    const { exitCode, stdout, stderr } = await runEntryInProcess(
      ['check'],
      deps,
    );

    expect(stdout).toBe(
      `\n${formatSummary([
        { step: 'shared-dirs:verify', target: 'root', outcome: PASSED },
        { step: 'check:test-names', target: 'root', outcome: PASSED },
        { step: 'format:check', target: 'root', outcome: failedWith(1) },
        ...resultsOf('lint', { root: PASSED }, PROJECT_MISSING),
        ...resultsOf('typecheck', { root: PASSED }, PROJECT_MISSING),
      ])}`,
    );
    expect(stderr).toBe('');
    expect(exitCode).toBe(1);
  });

  test.each<[AggregateCommand, readonly string[]]>([
    ['test:unit', ['--coverage']],
    ['test:browser', []],
    ['test:worker', ['--coverage', '--reporter=verbose']],
  ])(
    '%sに残りの引数%pを渡して実行し、失敗が無ければ0を返す',
    async (command, forwardedArgs) => {
      const { deps, calls } = createFakeWorkspace(everyDirWith(command));

      const { exitCode } = await runEntryInProcess(
        [command, ...forwardedArgs],
        deps,
      );

      expect(calls).toEqual(
        ALL_DIRS.map((dir) =>
          callOf(dir, 'bun', 'run', command, ...forwardedArgs),
        ),
      );
      expect(exitCode).toBe(0);
    },
  );
});

describe('直接実行したときの入口', () => {
  test(
    'テスト種別の一括実行で、ルートと各アプリのスクリプトに引数が渡り、子プロセスの出力の後に結果の表を表示する',
    async () => {
      const repoRoot = await createRepositoryWithScript({
        'package.json': packageJsonOf({ 'test:unit': 'echo root-unit' }),
        'apps/api/package.json': packageJsonOf({
          'test:unit': 'echo api-unit',
        }),
        'apps/client/package.json': packageJsonOf({}),
      });

      const { exitCode, stdout } = runEntry(repoRoot, [
        'test:unit',
        '--coverage',
      ]);

      expect(stdout).toBe(
        [
          '',
          '▶ ルート: bun run test:unit --coverage',
          'root-unit --coverage',
          '',
          '▶ apps/api: bun run test:unit --coverage',
          'api-unit --coverage',
          '',
          formatSummary(
            resultsOf(
              'test:unit',
              { root: PASSED, api: PASSED, client: SCRIPT_MISSING },
              PROJECT_MISSING,
            ),
          ),
        ].join('\n'),
      );
      expect(exitCode).toBe(0);
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    'checkで失敗した段階があっても後続をすべて実行し、終了コード1で終える',
    async () => {
      const repoRoot = await createRepositoryWithScript({
        'package.json': packageJsonOf({
          'shared-dirs:verify': 'echo verify',
          'check:test-names': 'exit 4',
          'format:check': 'echo format',
          lint: 'echo lint-root',
          typecheck: 'echo typecheck-root',
        }),
        'apps/api/package.json': packageJsonOf({
          lint: 'exit 2',
          typecheck: 'echo typecheck-api',
        }),
      });

      const { exitCode, stdout } = runEntry(repoRoot, ['check']);

      expect(stdout).toContain('\ntypecheck-api\n');
      expect(stdout).toEndWith(
        formatSummary([
          { step: 'shared-dirs:verify', target: 'root', outcome: PASSED },
          { step: 'check:test-names', target: 'root', outcome: failedWith(4) },
          { step: 'format:check', target: 'root', outcome: PASSED },
          ...resultsOf(
            'lint',
            { root: PASSED, api: failedWith(2) },
            PROJECT_MISSING,
          ),
          ...resultsOf(
            'typecheck',
            { root: PASSED, api: PASSED },
            PROJECT_MISSING,
          ),
        ]),
      );
      expect(exitCode).toBe(1);
    },
    SPAWN_TIMEOUT_MS,
  );
});

describe('ルートのpackage.json', () => {
  test('一括検査・命名検査・テスト種別ごとの一括実行・共有ディレクトリの確認とコピー配置のスクリプトが、それぞれの入口を呼び出す', () => {
    expect(readPackageScripts(REPO_ROOT)).toMatchObject({
      check: 'bun ./scripts/tooling/run-all.ts check',
      'check:test-names': 'bun ./scripts/tooling/check-test-names.ts',
      'test:all:unit': 'bun ./scripts/tooling/run-all.ts test:unit',
      'test:all:browser': 'bun ./scripts/tooling/run-all.ts test:browser',
      'test:all:worker': 'bun ./scripts/tooling/run-all.ts test:worker',
      'shared-dirs:verify': 'bun ./scripts/tooling/shared-dirs.ts verify',
      'shared-dirs:place': 'bun ./scripts/tooling/shared-dirs.ts place',
    });
  });

  test('一括検査と単体テストの一括実行で、ルートの段階が1つも飛ばされない', async () => {
    const deps: AggregateDependencies = {
      repoRoot: REPO_ROOT,
      readPackageScripts,
      runner: { run: () => Promise.resolve(0) },
    };

    const results = [
      ...(await runAggregate('check', [], deps)),
      ...(await runAggregate('test:unit', [], deps)),
    ];

    expect(
      results
        .filter(({ target }) => target === 'root')
        .map(({ step, outcome }) => ({ step, outcome })),
    ).toEqual(
      [...ROOT_CHECK_SCRIPTS, 'test:unit'].map((step) => ({
        step,
        outcome: PASSED,
      })),
    );
  });
});
