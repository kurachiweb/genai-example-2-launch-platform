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
import { command } from './install.ts';
import {
  EXIT_FAILURE,
  EXIT_SUCCESS,
  UsageError,
} from './shared/delivery-command.ts';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

const PACKAGE_JSONS: Readonly<Record<string, string>> = {
  'package.json': '{}',
  'apps/api/package.json': '{}',
  'apps/client/package.json': '{}',
  'apps/db/package.json': '{}',
};

const INSTALL = 'bun install --frozen-lockfile';

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

describe('install', () => {
  test('名前と説明を持つ', () => {
    expect(command.name).toBe('install');
    expect(command.description).not.toBe('');
  });

  test('package.jsonを持つルート・アプリ・共有ディレクトリの配置元で、CI=trueとロックファイルの固定で順に導入する', async () => {
    const { code, calls, stdout, stderr } = await runWith(
      createFakeRepoFiles(PACKAGE_JSONS),
    );

    expect(code).toBe(EXIT_SUCCESS);
    expect(calls.map((spec) => spec.cwd)).toEqual([
      FAKE_REPO_ROOT,
      `${FAKE_REPO_ROOT}/apps/api`,
      `${FAKE_REPO_ROOT}/apps/client`,
      `${FAKE_REPO_ROOT}/apps/db`,
    ]);
    expect(calls.every((spec) => commandLineOf(spec) === INSTALL)).toBe(true);
    expect(calls.every((spec) => spec.env?.CI === 'true')).toBe(true);
    expect(calls.every((spec) => spec.output === 'inherit')).toBe(true);
    expect(stdout.text()).toContain(`$ (apps/api) ${INSTALL}\n`);
    expect(stdout.text()).toContain(
      '依存パッケージの導入: 4件すべて成功しました。',
    );
    expect(stderr.text()).toBe('');
  });

  test('導入が失敗すれば、後続の対象を導入せずに失敗する', async () => {
    const { code, calls, stdout, stderr } = await runWith(
      createFakeRepoFiles(PACKAGE_JSONS),
      (spec) => (spec.cwd === `${FAKE_REPO_ROOT}/apps/api` ? 1 : 0),
    );

    expect(code).toBe(EXIT_FAILURE);
    expect(calls.map((spec) => spec.cwd)).toEqual([
      FAKE_REPO_ROOT,
      `${FAKE_REPO_ROOT}/apps/api`,
    ]);
    expect(stderr.text()).toBe(
      `依存パッケージの導入: apps/apiの${INSTALL}が終了コード1で失敗しました。\n`,
    );
    expect(stdout.text()).not.toContain('成功しました');
  });

  test('ルートのpackage.jsonが無ければ、何も導入せずに失敗する', async () => {
    const recording = createRecordingRunner();
    const fake = createFakeDeps(
      createFakeRepoFiles({ 'apps/api/package.json': '{}' }),
    );

    const message = await rejectionMessageOf(
      command.run([], { ...fake.deps, runner: recording.runner }),
    );

    expect(message).toBe('ルートのpackage.jsonが見つかりません。');
    expect(recording.calls()).toEqual([]);
  });

  test('引数を受け取ると引数の誤りとして拒否し、何も導入しない', async () => {
    const recording = createRecordingRunner();
    const fake = createFakeDeps(createFakeRepoFiles(PACKAGE_JSONS));
    const deps = { ...fake.deps, runner: recording.runner };

    const error = await command
      .run(['--production'], deps)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UsageError);
    expect(await rejectionMessageOf(command.run(['x'], deps))).toBe(
      '引数は受け取りません: x',
    );
    expect(recording.calls()).toEqual([]);
  });

  test('実際のリポジトリでは、ルート・5つのアプリ・DBスキーマの配置元を導入する', async () => {
    const { code, calls } = await runWith(createRepoFiles(REPO_ROOT));

    expect(code).toBe(EXIT_SUCCESS);
    expect(calls.map((spec) => spec.cwd)).toEqual(
      [
        '.',
        'apps/api',
        'apps/event',
        'apps/frontend-lib',
        'apps/client',
        'apps/admin',
        'apps/db',
      ].map((dir) => resolve(REPO_ROOT, dir)),
    );
  });
});
