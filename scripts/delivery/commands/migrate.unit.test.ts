import { describe, expect, test } from 'bun:test';

import type { CommandRunner, CommandSpec } from '../adapters/command-runner.ts';
import {
  DEPLOY_ENVIRONMENTS,
  type DeployEnvironment,
} from '../catalog/resource-catalog.ts';
import type { SecretEntry } from '../core/secret-scope.ts';
import { commandLineOf } from '../test-fixtures/command-runner.ts';
import {
  CATALOG_HOST,
  createFakeSecretSource,
  createRecordingGithub,
  folderKeyOf,
  infisicalRepoTexts,
} from '../test-fixtures/infisical.ts';
import { rejectionMessageOf } from '../test-fixtures/rejection.ts';
import {
  FAKE_REPO_ROOT,
  createFakeDeps,
  createFakeRepoFiles,
} from '../test-fixtures/repo-files.ts';
import { ACCOUNT_ID, PROJECT_ID } from '../test-fixtures/resource-catalog.ts';
import { command } from './migrate.ts';
import {
  EXIT_FAILURE,
  EXIT_SUCCESS,
  UsageError,
} from './shared/delivery-command.ts';

const CLOUDFLARE_TOKEN = 'fake-cloudflare-api-token';
const CLOUDFLARE_CHILD_ENV = {
  CLOUDFLARE_API_TOKEN: CLOUDFLARE_TOKEN,
  CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
};

const CLOUDFLARE_FOLDER: readonly SecretEntry[] = [
  { key: 'CLOUDFLARE_API_TOKEN', value: CLOUDFLARE_TOKEN },
];

const TOKEN_ENV = { INFISICAL_TOKEN: 'fake-access-token' };

const catalogPathOf = (env: DeployEnvironment): string =>
  `apps/infra/environments/${env}.json`;

const withoutMainD1 = (
  texts: Readonly<Record<string, string>>,
  env: DeployEnvironment,
): Record<string, string> => {
  const catalog = JSON.parse(texts[catalogPathOf(env)] ?? '{}') as Record<
    string,
    unknown
  >;
  return {
    ...texts,
    [catalogPathOf(env)]: JSON.stringify({
      ...catalog,
      d1: { other: { name: `app-other-${env}` } },
    }),
  };
};

interface RunOptions {
  readonly env?: Readonly<Record<string, string>>;
  readonly folders?: Readonly<Record<string, readonly SecretEntry[]>>;
  readonly texts?: Readonly<Record<string, string>>;
  readonly exitCode?: number;
}

const runWith = async (
  args: readonly string[],
  {
    env = TOKEN_ENV,
    folders = Object.fromEntries(
      DEPLOY_ENVIRONMENTS.map((name) => [
        folderKeyOf(name, '/ci/cloudflare'),
        CLOUDFLARE_FOLDER,
      ]),
    ),
    texts = infisicalRepoTexts(),
    exitCode = 0,
  }: RunOptions = {},
) => {
  const timeline: string[] = [];
  const calls: CommandSpec[] = [];
  const runner: CommandRunner = {
    run: (spec) => {
      calls.push(spec);
      timeline.push(`run:${commandLineOf(spec)}`);
      return Promise.resolve({ code: exitCode, stdout: '', stderr: '' });
    },
    start: () => {
      throw new Error('常駐の起動は使わない');
    },
  };
  const fake = createFakeDeps(createFakeRepoFiles(texts));
  const code = await command.run(args, {
    ...fake.deps,
    env,
    runner,
    github: createRecordingGithub(timeline),
    secrets: createFakeSecretSource({ timeline, folders }),
  });
  const shown = [
    fake.stdout.text(),
    fake.stderr.text(),
    ...timeline.filter((event) => event.startsWith('summary:')),
  ].join('\n');
  return { ...fake, code, timeline, calls, shown };
};

describe('migrate', () => {
  test('名前と説明を持つ', () => {
    expect(command.name).toBe('migrate');
    expect(command.description).not.toBe('');
  });

  test.each(DEPLOY_ENVIRONMENTS)(
    '%sでは、/ci/cloudflareのトークンをマスクしてから、apiで資源一覧のD1名と環境とリモートを指定してマイグレーションを適用する',
    async (env) => {
      const { code, timeline, calls, shown } = await runWith(['--env', env]);

      expect(code).toBe(EXIT_SUCCESS);
      expect(timeline.filter((event) => !event.startsWith('summary:'))).toEqual(
        [
          `export:${PROJECT_ID}:${env}:/ci/cloudflare:${CATALOG_HOST}`,
          `mask:${CLOUDFLARE_TOKEN}`,
          `run:bun x wrangler d1 migrations apply app-${env} --env ${env} --remote`,
        ],
      );
      const [migration] = calls;
      expect(migration?.cwd).toBe(`${FAKE_REPO_ROOT}/apps/api`);
      expect(migration?.env).toEqual(CLOUDFLARE_CHILD_ENV);
      expect(migration?.stdin).toBeUndefined();
      expect(migration?.output).toBe('inherit');
      expect(migration?.args.join(' ')).not.toContain(CLOUDFLARE_TOKEN);
      expect(shown).not.toContain(CLOUDFLARE_TOKEN);
    },
  );

  test('マイグレーションが失敗したら、コマンドと終了コードを示して失敗する', async () => {
    const { code, stderr } = await runWith(['--env', 'staging'], {
      exitCode: 3,
    });

    expect(code).toBe(EXIT_FAILURE);
    expect(stderr.text()).toContain(
      'bun x wrangler d1 migrations apply app-staging --env staging --remote',
    );
    expect(stderr.text()).toContain('終了コード3');
  });

  test('INFISICAL_TOKENが無ければ、先にログインするよう示して失敗する', async () => {
    const { code, timeline, stderr } = await runWith(['--env', 'prod'], {
      env: {},
    });

    expect(code).toBe(EXIT_FAILURE);
    expect(timeline).toEqual([]);
    expect(stderr.text()).toContain('infisical-login --scope prod');
  });

  test('/ci/cloudflareを取り出せなければ、フォルダの名前を示して失敗する', async () => {
    const { code, calls, stderr } = await runWith(['--env', 'staging'], {
      folders: {},
    });

    expect(code).toBe(EXIT_FAILURE);
    expect(calls).toEqual([]);
    expect(stderr.text()).toContain('/ci/cloudflare');
  });

  test('/ci/cloudflareにCloudflareのトークンが無ければ、キーの名前を示して失敗する', async () => {
    const { code, calls, stderr } = await runWith(['--env', 'staging'], {
      folders: { [folderKeyOf('staging', '/ci/cloudflare')]: [] },
    });

    expect(code).toBe(EXIT_FAILURE);
    expect(calls).toEqual([]);
    expect(stderr.text()).toContain('CLOUDFLARE_API_TOKEN');
  });

  test('資源一覧にd1.mainが無ければ、シークレットを取り出さずに失敗する', async () => {
    const { code, timeline, stderr } = await runWith(['--env', 'staging'], {
      texts: withoutMainD1(infisicalRepoTexts(), 'staging'),
    });

    expect(code).toBe(EXIT_FAILURE);
    expect(timeline.filter((event) => !event.startsWith('summary:'))).toEqual(
      [],
    );
    expect(stderr.text()).toContain('d1.main');
  });

  test.each([
    [[], '--envを指定してください(staging・prod)'],
    [
      ['--env', 'dev'],
      '--envはstaging・prodのいずれかにしてください(実際: dev)',
    ],
    [['--env', 'staging', '--app', 'api'], '未知のオプションです: --app'],
  ])(
    '引数%pは引数の誤りとして拒否し、何も実行しない',
    async (args, message) => {
      const error = await runWith(args).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UsageError);
      expect(await rejectionMessageOf(runWith(args))).toBe(message);
    },
  );
});
