import { describe, expect, test } from 'bun:test';

import type { AuditException } from '../core/audit-exceptions.ts';
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
import { command, createAuditCommand, todayInUtc } from './audit.ts';
import {
  EXIT_FAILURE,
  EXIT_SUCCESS,
  UsageError,
} from './shared/delivery-command.ts';

const PACKAGE_JSONS: Readonly<Record<string, string>> = {
  'package.json': '{}',
  'apps/api/package.json': '{}',
  'apps/db/package.json': '{}',
};

const EXCEPTION: AuditException = {
  advisory: 'GHSA-mrhx-c7xc-m3w5',
  reason: '到達しない経路でしか使われないため',
  reviewBy: '2026-11-30',
};

const runWith = async ({
  exceptions = [],
  today = '2026-10-29',
  exitCodeOf,
  args = [],
}: {
  exceptions?: readonly AuditException[];
  today?: string;
  exitCodeOf?: Parameters<typeof createRecordingRunner>[0];
  args?: readonly string[];
} = {}) => {
  const recording = createRecordingRunner(exitCodeOf);
  const fake = createFakeDeps(createFakeRepoFiles(PACKAGE_JSONS));
  const audit = createAuditCommand({ exceptions, today: () => today });
  const code = await audit.run(args, {
    ...fake.deps,
    runner: recording.runner,
  });
  return { ...fake, code, calls: recording.calls() };
};

describe('audit', () => {
  test('名前と説明を持ち、空の除外の一覧と現在の日付で動く', () => {
    expect(command.name).toBe('audit');
    expect(command.description).not.toBe('');
    expect(todayInUtc()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('導入の対象ごとに、重大度高以上と除外の一覧の--ignoreで脆弱性を確かめる', async () => {
    const { code, calls, stdout, stderr } = await runWith({
      exceptions: [EXCEPTION],
    });

    expect(code).toBe(EXIT_SUCCESS);
    expect(calls.map((spec) => spec.cwd)).toEqual([
      FAKE_REPO_ROOT,
      `${FAKE_REPO_ROOT}/apps/api`,
      `${FAKE_REPO_ROOT}/apps/db`,
    ]);
    expect(calls.map(commandLineOf)).toEqual(
      Array.from(
        { length: 3 },
        () => 'bun audit --audit-level=high --ignore=GHSA-mrhx-c7xc-m3w5',
      ),
    );
    expect(calls.every((spec) => spec.output === 'inherit')).toBe(true);
    expect(stdout.text()).toContain('$ (apps/db) bun audit --audit-level=high');
    expect(stdout.text()).toContain(
      '既知の脆弱性の確認: 3件すべて成功しました。',
    );
    expect(stderr.text()).toBe('');
  });

  test('脆弱性が見つかった対象があっても残りの対象を確かめ、見つかった対象を挙げて失敗する', async () => {
    const { code, calls, stderr, stdout } = await runWith({
      exitCodeOf: (spec) => (spec.cwd === FAKE_REPO_ROOT ? 0 : 1),
    });

    expect(code).toBe(EXIT_FAILURE);
    expect(calls).toHaveLength(3);
    expect(stderr.text()).toBe(
      '既知の脆弱性の確認: 重大度が高以上の脆弱性が見つかった対象があります(apps/api・apps/db)。\n',
    );
    expect(stdout.text()).not.toContain('成功しました');
  });

  test('見直し期限を過ぎた除外があれば、脆弱性を確かめずに失敗する', async () => {
    const { code, calls, stderr } = await runWith({
      exceptions: [EXCEPTION],
      today: '2026-12-01',
    });

    expect(code).toBe(EXIT_FAILURE);
    expect(calls).toEqual([]);
    expect(stderr.text()).toBe(
      [
        '既知の脆弱性の確認: 除外の一覧(scripts/delivery/core/audit-exceptions.ts)を見直してください。',
        '- GHSA-mrhx-c7xc-m3w5: 見直し期限(2026-11-30)を過ぎています。',
        '',
      ].join('\n'),
    );
  });

  test('引数を受け取ると引数の誤りとして拒否し、何も実行しない', async () => {
    const recording = createRecordingRunner();
    const fake = createFakeDeps(createFakeRepoFiles(PACKAGE_JSONS));
    const deps = { ...fake.deps, runner: recording.runner };

    const error = await command.run(['--fix'], deps).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UsageError);
    expect(await rejectionMessageOf(command.run(['x'], deps))).toBe(
      '引数は受け取りません: x',
    );
    expect(recording.calls()).toEqual([]);
  });
});
