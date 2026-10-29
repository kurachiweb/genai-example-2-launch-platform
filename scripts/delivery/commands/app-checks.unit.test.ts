import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

import { createRepoFiles, type RepoFiles } from '../adapters/repo-files.ts';
import {
  commandLineOf,
  createRecordingRunner,
} from '../test-fixtures/command-runner.ts';
import { rejectionMessageOf } from '../test-fixtures/rejection.ts';
import {
  createFakeDeps,
  createFakeRepoFiles,
  FAKE_REPO_ROOT,
} from '../test-fixtures/repo-files.ts';
import { command } from './app-checks.ts';
import {
  EXIT_FAILURE,
  EXIT_SUCCESS,
  UsageError,
} from './shared/delivery-command.ts';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

const API_PACKAGE_JSON = 'apps/api/package.json';

const packageJsonWith = (scripts: Readonly<Record<string, string>>): string =>
  JSON.stringify({ name: 'api', scripts });

const COMPLETE_FILES: Readonly<Record<string, string>> = {
  'package.json': '{}',
  [API_PACKAGE_JSON]: packageJsonWith({
    'db:migrations:check': 'bun ./scripts/check-migrations.ts',
    'test:smoke': 'bun ./scripts/smoke-wrangler-bundle.ts',
  }),
};

const MIGRATIONS_CHECK = 'bun run db:migrations:check';
const SMOKE_TEST = 'bun run test:smoke';

const runWith = async (
  files: RepoFiles,
  exitCodeOf?: Parameters<typeof createRecordingRunner>[0],
  args: readonly string[] = [],
) => {
  const recording = createRecordingRunner(exitCodeOf);
  const fake = createFakeDeps(files);
  const code = await command.run(args, {
    ...fake.deps,
    runner: recording.runner,
  });
  return { ...fake, code, calls: recording.calls() };
};

describe('app-checks', () => {
  test('名前と説明を持つ', () => {
    expect(command.name).toBe('app-checks');
    expect(command.description).not.toBe('');
  });

  test('apiのマイグレーションの検出、DIのスモークテストの順に、apiのディレクトリで実行する', async () => {
    const { code, calls, stdout, stderr } = await runWith(
      createFakeRepoFiles(COMPLETE_FILES),
    );

    expect(code).toBe(EXIT_SUCCESS);
    expect(calls.map(commandLineOf)).toEqual([MIGRATIONS_CHECK, SMOKE_TEST]);
    expect(
      calls.every((spec) => spec.cwd === `${FAKE_REPO_ROOT}/apps/api`),
    ).toBe(true);
    expect(calls.every((spec) => spec.output === 'inherit')).toBe(true);
    expect(stdout.text()).toContain(`$ (apps/api) ${MIGRATIONS_CHECK}\n`);
    expect(stdout.text()).toContain(`$ (apps/api) ${SMOKE_TEST}\n`);
    expect(stdout.text()).toContain(
      '生成物と設定の検査: 2件すべて成功しました。',
    );
    expect(stderr.text()).toBe('');
  });

  test('検査が失敗すれば、後続の検査を実行せずに失敗する', async () => {
    const { code, calls, stdout, stderr } = await runWith(
      createFakeRepoFiles(COMPLETE_FILES),
      (spec) => (commandLineOf(spec) === MIGRATIONS_CHECK ? 3 : 0),
    );

    expect(code).toBe(EXIT_FAILURE);
    expect(calls.map(commandLineOf)).toEqual([MIGRATIONS_CHECK]);
    expect(stderr.text()).toBe(
      `生成物と設定の検査: apps/apiの${MIGRATIONS_CHECK}が終了コード3で失敗しました。\n`,
    );
    expect(stdout.text()).not.toContain('成功しました');
  });

  test('アプリにスクリプトが無ければ、何も実行せずに欠けたスクリプトを挙げて失敗する', async () => {
    const { code, calls, stderr, summaries } = await runWith(
      createFakeRepoFiles({
        ...COMPLETE_FILES,
        [API_PACKAGE_JSON]: packageJsonWith({
          'test:smoke': 'bun ./scripts/smoke-wrangler-bundle.ts',
        }),
      }),
    );

    expect(code).toBe(EXIT_FAILURE);
    expect(calls).toEqual([]);
    expect(stderr.text()).toContain(
      `- ${API_PACKAGE_JSON}: スクリプトdb:migrations:checkがありません`,
    );
    expect(summaries().join('')).toContain('### 生成物と設定の検査');
  });

  test('アプリのpackage.jsonが読めなければ、何も実行せずに失敗する', async () => {
    const { code, calls, stderr } = await runWith(
      createFakeRepoFiles({ 'package.json': '{}' }),
    );

    expect(code).toBe(EXIT_FAILURE);
    expect(calls).toEqual([]);
    expect(stderr.text()).toContain(
      `- ${API_PACKAGE_JSON}を読み込めませんでした`,
    );
  });

  test('アプリのpackage.jsonがJSONとして解析できなければ、何も実行せずに失敗する', async () => {
    const { code, calls, stderr } = await runWith(
      createFakeRepoFiles({ ...COMPLETE_FILES, [API_PACKAGE_JSON]: '{' }),
    );

    expect(code).toBe(EXIT_FAILURE);
    expect(calls).toEqual([]);
    expect(stderr.text()).toContain(
      `- ${API_PACKAGE_JSON}: JSONとして解析できません`,
    );
  });

  test('引数を受け取ると引数の誤りとして拒否し、何も実行しない', async () => {
    const recording = createRecordingRunner();
    const fake = createFakeDeps(createFakeRepoFiles(COMPLETE_FILES));
    const deps = { ...fake.deps, runner: recording.runner };

    const error = await command.run(['api'], deps).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UsageError);
    expect(await rejectionMessageOf(command.run(['x'], deps))).toBe(
      '引数は受け取りません: x',
    );
    expect(recording.calls()).toEqual([]);
  });

  test('実際のリポジトリのapiには表のスクリプトがすべてあり、apiのディレクトリで実行する', async () => {
    const { code, calls } = await runWith(createRepoFiles(REPO_ROOT));

    expect(code).toBe(EXIT_SUCCESS);
    expect(calls.map((spec) => [spec.cwd, commandLineOf(spec)])).toEqual([
      [resolve(REPO_ROOT, 'apps/api'), MIGRATIONS_CHECK],
      [resolve(REPO_ROOT, 'apps/api'), SMOKE_TEST],
    ]);
  });
});
