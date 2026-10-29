import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';

import type { CommandSpec } from '../adapters/command-runner.ts';
import { DEPLOY_ENVIRONMENTS } from '../catalog/resource-catalog.ts';
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
import { command } from './rehearse.ts';
import {
  EXIT_FAILURE,
  EXIT_SUCCESS,
  UsageError,
} from './shared/delivery-command.ts';

const RUNNER_TEMP = '/runner-temp';

const DRY_RUN = 'bun x wrangler deploy --dry-run';
const BUILD = 'bun run build';

const SECRET_ENV = {
  CLOUDFLARE_API_TOKEN: 'cloudflare-token-value',
  INFISICAL_TOKEN: 'infisical-token-value',
};

const runWith = async (
  args: readonly string[],
  {
    exitCodeOf,
    env = { RUNNER_TEMP },
  }: {
    readonly exitCodeOf?: (spec: CommandSpec) => number;
    readonly env?: Readonly<Record<string, string | undefined>>;
  } = {},
) => {
  const recording = createRecordingRunner(exitCodeOf);
  const fake = createFakeDeps(createFakeRepoFiles({}));
  const code = await command.run(args, {
    ...fake.deps,
    env,
    runner: recording.runner,
  });
  return { ...fake, code, calls: recording.calls() };
};

const stepsOf = (calls: readonly CommandSpec[]) =>
  calls.map((spec) => ({
    cwd: spec.cwd,
    line: commandLineOf(spec),
    env: spec.env,
  }));

describe('rehearse', () => {
  test('名前と説明を持つ', () => {
    expect(command.name).toBe('rehearse');
    expect(command.description).not.toBe('');
  });

  test.each(DEPLOY_ENVIRONMENTS)(
    '%sでは、api・eventを環境を指定してdry-runし、client・adminを環境を指定してビルドした後にビルドの設定でdry-runする',
    async (env) => {
      const { code, calls, stdout, stderr } = await runWith(['--env', env]);

      const outdirOf = (app: string) =>
        `${RUNNER_TEMP}/rehearsal/${env}/${app}`;
      expect(code).toBe(EXIT_SUCCESS);
      expect(stepsOf(calls)).toEqual([
        {
          cwd: `${FAKE_REPO_ROOT}/apps/api`,
          line: `${DRY_RUN} --env ${env} --outdir ${outdirOf('api')}`,
          env: undefined,
        },
        {
          cwd: `${FAKE_REPO_ROOT}/apps/event`,
          line: `${DRY_RUN} --env ${env} --outdir ${outdirOf('event')}`,
          env: undefined,
        },
        {
          cwd: `${FAKE_REPO_ROOT}/apps/client`,
          line: BUILD,
          env: { CLOUDFLARE_ENV: env },
        },
        {
          cwd: `${FAKE_REPO_ROOT}/apps/client`,
          line: `${DRY_RUN} --outdir ${outdirOf('client')}`,
          env: undefined,
        },
        {
          cwd: `${FAKE_REPO_ROOT}/apps/admin`,
          line: BUILD,
          env: { CLOUDFLARE_ENV: env },
        },
        {
          cwd: `${FAKE_REPO_ROOT}/apps/admin`,
          line: `${DRY_RUN} --outdir ${outdirOf('admin')}`,
          env: undefined,
        },
      ]);
      expect(calls.every((spec) => spec.output === 'inherit')).toBe(true);
      expect(stdout.text()).toContain(
        `$ (apps/api) ${DRY_RUN} --env ${env} --outdir ${outdirOf('api')}\n`,
      );
      expect(stdout.text()).toContain(
        `${env}のデプロイの予行: 4件のWorkerすべて成功しました。\n`,
      );
      expect(stderr.text()).toBe('');
    },
  );

  test('秘密値を取り出さず渡さず、資源を作るコマンドを呼ばない', async () => {
    const { code, calls } = await runWith(['--env', 'prod'], {
      env: { RUNNER_TEMP, ...SECRET_ENV },
    });

    expect(code).toBe(EXIT_SUCCESS);
    const lines = calls.map(commandLineOf);
    expect(
      lines.every((line) => line === BUILD || line.startsWith(`${DRY_RUN} `)),
    ).toBe(true);
    expect(lines.some((line) => line.includes('--secrets-file'))).toBe(false);
    expect(calls.every((spec) => spec.stdin === undefined)).toBe(true);
    expect(
      calls.flatMap((spec) => Object.values(spec.env ?? {})),
    ).not.toContainAnyValues(Object.values(SECRET_ENV));
    expect(
      calls.flatMap((spec) => Object.keys(spec.env ?? {})),
    ).not.toContainAnyValues(Object.keys(SECRET_ENV));
  });

  test('出力先はリポジトリの外の一時ディレクトリにし、RUNNER_TEMPが無ければOSの一時ディレクトリを使う', async () => {
    const { calls } = await runWith(['--env', 'staging'], { env: {} });

    const outdirs = calls.flatMap((spec) => {
      const index = spec.args.indexOf('--outdir');
      return index === -1 ? [] : [spec.args[index + 1]];
    });
    expect(outdirs).toEqual(
      ['api', 'event', 'client', 'admin'].map(
        (app) => `${tmpdir()}/rehearsal/staging/${app}`,
      ),
    );
  });

  test('dry-runが失敗すれば、後続のWorkerを予行せずに失敗する', async () => {
    const { code, calls, stdout, stderr } = await runWith(
      ['--env', 'staging'],
      {
        exitCodeOf: (spec) =>
          spec.cwd === `${FAKE_REPO_ROOT}/apps/event` ? 1 : 0,
      },
    );

    expect(code).toBe(EXIT_FAILURE);
    expect(calls.map((spec) => spec.cwd)).toEqual([
      `${FAKE_REPO_ROOT}/apps/api`,
      `${FAKE_REPO_ROOT}/apps/event`,
    ]);
    expect(stderr.text()).toBe(
      `stagingのデプロイの予行: apps/eventの${DRY_RUN} --env staging --outdir ${RUNNER_TEMP}/rehearsal/staging/eventが終了コード1で失敗しました。\n`,
    );
    expect(stdout.text()).not.toContain('成功しました');
  });

  test('ビルドが失敗すれば、そのWorkerのdry-runと後続のWorkerを実行せずに失敗する', async () => {
    const { code, calls, stderr } = await runWith(['--env', 'prod'], {
      exitCodeOf: (spec) =>
        spec.cwd === `${FAKE_REPO_ROOT}/apps/client` &&
        commandLineOf(spec) === BUILD
          ? 2
          : 0,
    });

    expect(code).toBe(EXIT_FAILURE);
    expect(stepsOf(calls).map(({ cwd, line }) => [cwd, line])).toEqual([
      [
        `${FAKE_REPO_ROOT}/apps/api`,
        `${DRY_RUN} --env prod --outdir ${RUNNER_TEMP}/rehearsal/prod/api`,
      ],
      [
        `${FAKE_REPO_ROOT}/apps/event`,
        `${DRY_RUN} --env prod --outdir ${RUNNER_TEMP}/rehearsal/prod/event`,
      ],
      [`${FAKE_REPO_ROOT}/apps/client`, BUILD],
    ]);
    expect(stderr.text()).toBe(
      `prodのデプロイの予行: apps/clientの${BUILD}が終了コード2で失敗しました。\n`,
    );
  });

  test.each([
    [[], '--envを指定してください(staging・prod)'],
    [
      ['--env', 'dev'],
      '--envはstaging・prodのいずれかにしてください(実際: dev)',
    ],
    [['--env', 'staging', '--app', 'api'], '未知のオプションです: --app'],
    [['--env', 'staging', '--', 'echo'], '`--`の後のコマンドは受け取りません'],
  ])(
    '引数%pは引数の誤りとして拒否し、何も実行しない',
    async (args, message) => {
      const recording = createRecordingRunner();
      const fake = createFakeDeps(createFakeRepoFiles({}));
      const deps = { ...fake.deps, runner: recording.runner };

      const error = await command.run(args, deps).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UsageError);
      expect(await rejectionMessageOf(command.run(args, deps))).toBe(message);
      expect(recording.calls()).toEqual([]);
    },
  );
});
