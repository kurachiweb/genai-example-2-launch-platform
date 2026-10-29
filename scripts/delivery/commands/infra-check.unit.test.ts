import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

import type {
  CommandResult,
  CommandRunner,
  CommandSpec,
} from '../adapters/command-runner.ts';
import type { GithubActionsIo } from '../adapters/github-actions.ts';
import { createRepoFiles, type RepoFiles } from '../adapters/repo-files.ts';
import { rejectionMessageOf } from '../test-fixtures/rejection.ts';
import { createRecordingOutput } from '../test-fixtures/text-output.ts';
import { command } from './infra-check.ts';
import {
  type DeliveryDeps,
  EXIT_FAILURE,
  EXIT_SUCCESS,
  UsageError,
} from './shared/delivery-command.ts';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');
const FAKE_ROOT = '/repo';

const INFRA_FILES: readonly string[] = [
  'apps/infra/live/main.tf',
  'apps/infra/live/versions.tf',
  'apps/infra/live/tests/live.tftest.hcl',
  'apps/infra/live/.terraform/modules/modules.json',
  'apps/infra/modules/storage/main.tf',
  'apps/infra/modules/storage/tests/storage.tftest.hcl',
  'apps/infra/modules/worker-routing/main.tf',
  'apps/infra/environments/staging.json',
];

const createFakeFiles = (paths: readonly string[]): RepoFiles => ({
  root: FAKE_ROOT,
  readText: () => Promise.reject(new Error('読み込みは使わない')),
  writeText: () => Promise.reject(new Error('書き込みは使わない')),
  exists: (path) => Promise.resolve(paths.includes(path)),
  list: (pattern) => {
    const glob = new Bun.Glob(pattern);
    return Promise.resolve(paths.filter((path) => glob.match(path)).toSorted());
  },
});

const createFakeRunner = (failAt?: { line: string; code: number }) => {
  const calls: CommandSpec[] = [];
  const runner: CommandRunner = {
    run: (spec) => {
      calls.push(spec);
      const line = [spec.command, ...spec.args].join(' ');
      const code = failAt?.line === line ? failAt.code : 0;
      const result: CommandResult = { code, stdout: '', stderr: '' };
      return Promise.resolve(result);
    },
    start: () => {
      throw new Error('常駐の起動は使わない');
    },
  };
  return { runner, calls };
};

const github: GithubActionsIo = {
  mask: () => undefined,
  exportEnv: () => undefined,
  summary: () => undefined,
  oidcToken: () => Promise.reject(new Error('OIDCは使わない')),
};

const createDeps = (
  runner: CommandRunner,
  files: RepoFiles = createFakeFiles(INFRA_FILES),
) => {
  const stdout = createRecordingOutput();
  const stderr = createRecordingOutput();
  const deps: DeliveryDeps = {
    repoRoot: files.root,
    env: {},
    runner,
    files,
    github,
    secrets: {
      login: () => Promise.reject(new Error('ログインは使わない')),
      exportFolder: () => Promise.reject(new Error('取り出しは使わない')),
    },
    stdout,
    stderr,
  };
  return { deps, stdout, stderr };
};

const linesOf = (calls: readonly CommandSpec[]): readonly string[] =>
  calls.map((spec) => [spec.command, ...spec.args].join(' '));

const initOf = (dir: string): string =>
  `tofu -chdir=${dir} init -backend=false -lockfile=readonly -input=false`;

const EXPECTED_LINES: readonly string[] = [
  'tofu fmt -check -recursive apps/infra',
  initOf('apps/infra/live'),
  'tofu -chdir=apps/infra/live validate',
  'tofu -chdir=apps/infra/live test',
  initOf('apps/infra/modules/storage'),
  'tofu -chdir=apps/infra/modules/storage validate',
  'tofu -chdir=apps/infra/modules/storage test',
  initOf('apps/infra/modules/worker-routing'),
  'tofu -chdir=apps/infra/modules/worker-routing validate',
];

describe('infra-check', () => {
  test('名前と説明を持つ', () => {
    expect(command.name).toBe('infra-check');
    expect(command.description).not.toBe('');
  });

  test('整形の検査・ルートと各モジュールの初期化・妥当性の検査・テストを、リポジトリのルートで出力を表示しながら順に実行し、終了コード0を返す', async () => {
    const { runner, calls } = createFakeRunner();
    const { deps, stdout, stderr } = createDeps(runner);

    const code = await command.run([], deps);

    expect(code).toBe(EXIT_SUCCESS);
    expect(linesOf(calls)).toEqual(EXPECTED_LINES);
    expect(calls.every((spec) => spec.cwd === FAKE_ROOT)).toBe(true);
    expect(calls.every((spec) => spec.output === 'inherit')).toBe(true);
    expect(stdout.text()).toContain(
      `$ tofu fmt -check -recursive apps/infra\n`,
    );
    expect(stdout.text()).toContain('IaCの検査: すべて成功しました。');
    expect(stderr.text()).toBe('');
  });

  test('整形の検査が失敗すれば、初期化以降を実行せずに終了コード1を返す', async () => {
    const { runner, calls } = createFakeRunner({
      line: 'tofu fmt -check -recursive apps/infra',
      code: 3,
    });
    const { deps, stdout, stderr } = createDeps(runner);

    const code = await command.run([], deps);

    expect(code).toBe(EXIT_FAILURE);
    expect(linesOf(calls)).toEqual(['tofu fmt -check -recursive apps/infra']);
    expect(stderr.text()).toBe(
      'IaCの検査: tofu fmt -check -recursive apps/infra が終了コード3で失敗しました。\n',
    );
    expect(stdout.text()).not.toContain('すべて成功しました');
  });

  test('途中のモジュールの妥当性の検査が失敗すれば、そこで止まり後続のテストとモジュールを実行しない', async () => {
    const failing = 'tofu -chdir=apps/infra/modules/storage validate';
    const { runner, calls } = createFakeRunner({ line: failing, code: 1 });
    const { deps, stderr } = createDeps(runner);

    const code = await command.run([], deps);

    expect(code).toBe(EXIT_FAILURE);
    expect(linesOf(calls)).toEqual(
      EXPECTED_LINES.slice(0, EXPECTED_LINES.indexOf(failing) + 1),
    );
    expect(stderr.text()).toContain(`${failing} が終了コード1で失敗しました。`);
  });

  test('テストが失敗すれば、後続のモジュールを実行しない', async () => {
    const failing = 'tofu -chdir=apps/infra/live test';
    const { runner, calls } = createFakeRunner({ line: failing, code: 1 });
    const { deps } = createDeps(runner);

    const code = await command.run([], deps);

    expect(code).toBe(EXIT_FAILURE);
    expect(linesOf(calls).at(-1)).toBe(failing);
    expect(linesOf(calls)).not.toContain(initOf('apps/infra/modules/storage'));
  });

  test('引数を受け取ると引数の誤りとして拒否し、何も実行しない', async () => {
    const { runner, calls } = createFakeRunner();
    const { deps } = createDeps(runner);

    const message = await rejectionMessageOf(command.run(['--env'], deps));

    expect(message).toBe('引数は受け取りません: --env');
    expect(calls).toEqual([]);
    const error = await command.run(['x'], deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UsageError);
  });

  test('ルートモジュールの定義が無ければ、何も実行せずに失敗する', async () => {
    const { runner, calls } = createFakeRunner();
    const { deps } = createDeps(
      runner,
      createFakeFiles(['apps/infra/modules/storage/main.tf']),
    );

    const message = await rejectionMessageOf(command.run([], deps));

    expect(message).toBe(
      'ルートモジュール(apps/infra/live)の定義が見つかりません。',
    );
    expect(calls).toEqual([]);
  });

  test('実際のリポジトリでは、ルートモジュールと4つのモジュールをすべてテスト付きで検査する', async () => {
    const { runner, calls } = createFakeRunner();
    const { deps } = createDeps(runner, createRepoFiles(REPO_ROOT));

    const code = await command.run([], deps);

    expect(code).toBe(EXIT_SUCCESS);
    const dirs = [
      'apps/infra/live',
      'apps/infra/modules/edge-services',
      'apps/infra/modules/messaging',
      'apps/infra/modules/storage',
      'apps/infra/modules/worker-routing',
    ];
    expect(linesOf(calls)).toEqual([
      'tofu fmt -check -recursive apps/infra',
      ...dirs.flatMap((dir) => [
        initOf(dir),
        `tofu -chdir=${dir} validate`,
        `tofu -chdir=${dir} test`,
      ]),
    ]);
    expect(calls.every((spec) => spec.cwd === REPO_ROOT)).toBe(true);
  });
});
