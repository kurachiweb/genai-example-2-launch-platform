import { describe, expect, test } from 'bun:test';

import { createRecordingRunner } from '../test-fixtures/command-runner.ts';
import { rejectionMessageOf } from '../test-fixtures/rejection.ts';
import {
  createFakeDeps,
  createFakeRepoFiles,
} from '../test-fixtures/repo-files.ts';
import { command } from './coverage-merge.ts';
import {
  EXIT_FAILURE,
  EXIT_SUCCESS,
  UsageError,
} from './shared/delivery-command.ts';

const MERGED = 'coverage/merged/lcov.info';

const LCOV_FILES: Readonly<Record<string, string>> = {
  'coverage/unit/lcov.info': 'TN:\nSF:scripts/a.ts\nend_of_record\n',
  'coverage/unit/.lcov.info.0123456789abcdef.tmp':
    'TN:\nSF:scripts/partial.ts\nend_of_record\n',
  'apps/api/coverage/unit/lcov.info': 'TN:\nSF:src/b.ts\nend_of_record\n',
  'apps/api/coverage/worker/lcov.info': 'TN:\nSF:db/client.ts\nend_of_record\n',
  'apps/client/coverage/browser/lcov.info':
    'TN:\nSF:src/c.tsx\nend_of_record\n',
};

const runWith = async (
  texts: Readonly<Record<string, string>>,
  args: readonly string[] = [],
) => {
  const files = createFakeRepoFiles(texts);
  const fake = createFakeDeps(files);
  const code = await command.run(args, fake.deps);
  return { ...fake, code, files };
};

describe('coverage-merge', () => {
  test('名前と説明を持つ', () => {
    expect(command.name).toBe('coverage-merge');
    expect(command.description).not.toBe('');
  });

  test('ルートと各アプリの単体・ブラウザ・Workers統合の結果を、アプリのディレクトリを前置して1つのlcovへ合算する', async () => {
    const { code, files, stdout, stderr } = await runWith(LCOV_FILES);

    expect(code).toBe(EXIT_SUCCESS);
    expect(files.written()).toEqual({
      [MERGED]: [
        'TN:',
        'SF:scripts/a.ts',
        'end_of_record',
        'TN:',
        'SF:apps/api/src/b.ts',
        'end_of_record',
        'TN:',
        'SF:apps/api/db/client.ts',
        'end_of_record',
        'TN:',
        'SF:apps/client/src/c.tsx',
        'end_of_record',
        '',
      ].join('\n'),
    });
    expect(stdout.text()).toBe(
      [
        '- coverage/unit/lcov.info',
        '- apps/api/coverage/unit/lcov.info',
        '- apps/api/coverage/worker/lcov.info',
        '- apps/client/coverage/browser/lcov.info',
        `カバレッジの合算: 4件の結果を${MERGED}へ合算しました。`,
        '',
      ].join('\n'),
    );
    expect(stderr.text()).toBe('');
  });

  test('単体テストの結果は固定のパスだけを読み、書き出し途中の一時ファイルを拾わない', async () => {
    const { files } = await runWith(LCOV_FILES);

    expect(files.readPaths()).not.toContain(
      'coverage/unit/.lcov.info.0123456789abcdef.tmp',
    );
    expect(files.written()[MERGED]).not.toContain('partial.ts');
  });

  test('合算する結果が1つも無ければ、書き出さずに失敗する', async () => {
    const { code, files, stderr } = await runWith({
      'coverage/unit/.lcov.info.0123456789abcdef.tmp': 'SF:a.ts\n',
    });

    expect(code).toBe(EXIT_FAILURE);
    expect(files.written()).toEqual({});
    expect(stderr.text()).toBe(
      'カバレッジの合算: 合算するlcov.infoが見つかりません。先にカバレッジの計測付きでテストを実行してください。\n',
    );
  });

  test('引数を受け取ると引数の誤りとして拒否し、何も書き出さない', async () => {
    const files = createFakeRepoFiles(LCOV_FILES);
    const fake = createFakeDeps(files);
    const deps = { ...fake.deps, runner: createRecordingRunner().runner };

    const error = await command.run(['--out'], deps).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UsageError);
    expect(await rejectionMessageOf(command.run(['x'], deps))).toBe(
      '引数は受け取りません: x',
    );
    expect(files.written()).toEqual({});
  });
});
