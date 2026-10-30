import { describe, expect, test } from 'bun:test';

import type {
  CommandResult,
  CommandRunner,
  CommandSpec,
} from '../adapters/command-runner.ts';
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
import { DOCKERFILE, replaceOnce } from '../test-fixtures/workflows.ts';
import { command } from './ensure-email-subscription.ts';
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
const ZONE_ID = 'fedcba9876543210fedcba9876543210';
const EVENTS = [
  'message.bounced',
  'message.complained',
  'message.rejected',
  'message.failed',
] as const;

const CLOUDFLARE_FOLDER: readonly SecretEntry[] = [
  { key: 'CLOUDFLARE_API_TOKEN', value: CLOUDFLARE_TOKEN },
];

const TOKEN_ENV = { INFISICAL_TOKEN: 'fake-access-token' };

const queueOf = (env: DeployEnvironment): string => `app-email-events-${env}`;
const subscriptionNameOf = (env: DeployEnvironment): string =>
  `app-email-subscription-${env}`;
const domainOf = (env: DeployEnvironment): string =>
  `mail-${env}.launch.example`;

const VERSION_LINE = 'wrangler --version';
const listLineOf = (env: DeployEnvironment): string =>
  `wrangler queues subscription list ${queueOf(env)} --json`;
const createLineOf = (env: DeployEnvironment): string =>
  [
    'wrangler queues subscription create',
    queueOf(env),
    '--source email.sending',
    `--events ${EVENTS.join(',')}`,
    `--zone-id ${ZONE_ID}`,
    `--domain ${domainOf(env)}`,
    `--name ${subscriptionNameOf(env)}`,
  ].join(' ');

const subscriptionOf = (
  env: DeployEnvironment,
  patch: Readonly<Record<string, unknown>> = {},
) => ({
  id: 'sub-0001',
  name: subscriptionNameOf(env),
  enabled: true,
  source: { type: 'email.sending', zone_id: ZONE_ID, domain: domainOf(env) },
  destination: { type: 'queues.queue', queue_id: 'queue-0001' },
  events: EVENTS,
  ...patch,
});

type Outputs = Readonly<Record<string, Partial<CommandResult>>>;

interface RunOptions {
  readonly env?: Readonly<Record<string, string>>;
  readonly folders?: Readonly<Record<string, readonly SecretEntry[]>>;
  readonly texts?: Readonly<Record<string, string>>;
  readonly outputs?: (env: DeployEnvironment) => Outputs;
}

const absentOutputs =
  (patch: Outputs = {}) =>
  (env: DeployEnvironment): Outputs => ({
    [VERSION_LINE]: { stdout: '4.152.0\n' },
    [listLineOf(env)]: { stdout: '[]\n' },
    ...patch,
  });

const listOutputs =
  (subscriptions: readonly unknown[]) =>
  (env: DeployEnvironment): Outputs =>
    absentOutputs({
      [listLineOf(env)]: { stdout: JSON.stringify(subscriptions, null, 2) },
    })(env);

const envOf = (args: readonly string[]): DeployEnvironment =>
  args.includes('prod') ? 'prod' : 'staging';

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
    texts = { ...infisicalRepoTexts(), Dockerfile: DOCKERFILE },
    outputs = absentOutputs(),
  }: RunOptions = {},
) => {
  const timeline: string[] = [];
  const calls: CommandSpec[] = [];
  const outputsOfEnv = outputs(envOf(args));
  const runner: CommandRunner = {
    run: (spec) => {
      calls.push(spec);
      const line = commandLineOf(spec);
      timeline.push(`run:${line}`);
      return Promise.resolve({
        code: 0,
        stdout: '',
        stderr: '',
        ...outputsOfEnv[line],
      });
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
  const summaries = timeline.filter((event) => event.startsWith('summary:'));
  const shown = [fake.stdout.text(), fake.stderr.text(), ...summaries].join(
    '\n',
  );
  return {
    ...fake,
    code,
    timeline: timeline.filter((event) => !event.startsWith('summary:')),
    summaries,
    calls,
    shown,
  };
};

describe('ensure-email-subscription', () => {
  test('名前と説明を持つ', () => {
    expect(command.name).toBe('ensure-email-subscription');
    expect(command.description).not.toBe('');
  });

  test.each(DEPLOY_ENVIRONMENTS)(
    '%sで購読が無ければ、Wranglerの版を確かめ、トークンをマスクしてから、送信ドメイン・ゾーン・4つのイベント・名前を指定して作成する',
    async (env) => {
      const { code, timeline, calls, shown, summaries } = await runWith([
        '--env',
        env,
      ]);

      expect(code).toBe(EXIT_SUCCESS);
      expect(timeline).toEqual([
        `run:${VERSION_LINE}`,
        `export:${PROJECT_ID}:${env}:/ci/cloudflare:${CATALOG_HOST}`,
        `mask:${CLOUDFLARE_TOKEN}`,
        `run:${listLineOf(env)}`,
        `run:${createLineOf(env)}`,
      ]);
      const [version, list, create] = calls;
      expect(version?.env).toBeUndefined();
      expect(version?.output).toBe('capture');
      for (const spec of [list, create]) {
        expect(spec?.cwd).toBe(FAKE_REPO_ROOT);
        expect(spec?.env).toEqual(CLOUDFLARE_CHILD_ENV);
        expect(spec?.stdin).toBeUndefined();
        expect(spec?.args.join(' ')).not.toContain(CLOUDFLARE_TOKEN);
      }
      expect(list?.output).toBe('capture');
      expect(create?.output).toBe('inherit');
      expect(summaries.join('\n')).toContain(
        `Queue ${queueOf(env)}への購読${subscriptionNameOf(env)}を作成しました`,
      );
      expect(shown).not.toContain(CLOUDFLARE_TOKEN);
    },
  );

  test('同じ購読があれば、何も作らずに成功する', async () => {
    const { code, timeline, stdout, summaries } = await runWith(
      ['--env', 'staging'],
      { outputs: listOutputs([subscriptionOf('staging')]) },
    );

    expect(code).toBe(EXIT_SUCCESS);
    expect(timeline.at(-1)).toBe(`run:${listLineOf('staging')}`);
    expect(stdout.text()).toContain('設定どおりです');
    expect(summaries.join('\n')).toContain('設定どおりです');
  });

  test('購読の内容が異なれば、差分を表示し、作り直さずに失敗する', async () => {
    const { code, timeline, stderr, summaries } = await runWith(
      ['--env', 'prod'],
      {
        outputs: listOutputs([
          subscriptionOf('prod', {
            source: {
              type: 'email.sending',
              zone_id: ZONE_ID,
              domain: 'mail.launch.example',
            },
            events: ['message.bounced', 'message.delivered'],
          }),
        ]),
      },
    );

    expect(code).toBe(EXIT_FAILURE);
    expect(timeline.at(-1)).toBe(`run:${listLineOf('prod')}`);
    for (const difference of [
      `送信ドメイン: 期待 ${domainOf('prod')}、実際 mail.launch.example`,
      '不足しているイベント: message.complained, message.rejected, message.failed',
      '余分なイベント: message.delivered',
    ]) {
      expect(stderr.text()).toContain(difference);
      expect(summaries.join('\n')).toContain(difference);
    }
    expect(stderr.text()).toContain(queueOf('prod'));
  });

  test('購読の一覧を読み取れなければ、理由を示して失敗する', async () => {
    const { code, timeline, stderr } = await runWith(['--env', 'staging'], {
      outputs: absentOutputs({
        [listLineOf('staging')]: { stdout: 'No event subscriptions found.' },
      }),
    });

    expect(code).toBe(EXIT_FAILURE);
    expect(timeline.at(-1)).toBe(`run:${listLineOf('staging')}`);
    expect(stderr.text()).toContain('購読の一覧をJSONとして読めません');
  });

  test('購読の一覧の取得が失敗したら、コマンドと終了コードとWranglerの誤りを示して失敗する', async () => {
    const { code, timeline, stderr } = await runWith(['--env', 'staging'], {
      outputs: absentOutputs({
        [listLineOf('staging')]: {
          code: 1,
          stderr: 'Queue "app-email-events-staging" does not exist.',
        },
      }),
    });

    expect(code).toBe(EXIT_FAILURE);
    expect(timeline.at(-1)).toBe(`run:${listLineOf('staging')}`);
    expect(stderr.text()).toContain(listLineOf('staging'));
    expect(stderr.text()).toContain('終了コード1');
    expect(stderr.text()).toContain('does not exist');
  });

  test('購読の作成が失敗したら、コマンドと終了コードを示して失敗する', async () => {
    const { code, stderr, summaries } = await runWith(['--env', 'staging'], {
      outputs: absentOutputs({ [createLineOf('staging')]: { code: 4 } }),
    });

    expect(code).toBe(EXIT_FAILURE);
    expect(stderr.text()).toContain(createLineOf('staging'));
    expect(stderr.text()).toContain('終了コード4');
    expect(summaries).toEqual([]);
  });

  test('WranglerがDockerfileのWRANGLER_VERSIONと違う版なら、シークレットを取り出さずに失敗する', async () => {
    const { code, timeline, stderr } = await runWith(['--env', 'staging'], {
      outputs: absentOutputs({
        [VERSION_LINE]: { stdout: ' ⛅️ wrangler 4.124.0\n' },
      }),
    });

    expect(code).toBe(EXIT_FAILURE);
    expect(timeline).toEqual([`run:${VERSION_LINE}`]);
    expect(stderr.text()).toContain('4.124.0');
    expect(stderr.text()).toContain('WRANGLER_VERSION(4.152.0)');
  });

  test.each([
    ['版を読み取れない', { stdout: 'unknown\n' }, 'unknown'],
    ['起動に失敗する', { code: 127, stderr: 'not found' }, '終了コード127'],
  ])(
    'Wranglerの版が%sなら、シークレットを取り出さずに失敗する',
    async (_, result, message) => {
      const { code, timeline, stderr } = await runWith(['--env', 'staging'], {
        outputs: absentOutputs({ [VERSION_LINE]: result }),
      });

      expect(code).toBe(EXIT_FAILURE);
      expect(timeline).toEqual([`run:${VERSION_LINE}`]);
      expect(stderr.text()).toContain(message);
    },
  );

  test('DockerfileからWRANGLER_VERSIONを読めなければ、何も実行せずに失敗する', async () => {
    const { code, timeline, stderr } = await runWith(['--env', 'staging'], {
      texts: {
        ...infisicalRepoTexts(),
        Dockerfile: replaceOnce(
          DOCKERFILE,
          'ARG WRANGLER_VERSION=4.152.0\n',
          '',
        ),
      },
    });

    expect(code).toBe(EXIT_FAILURE);
    expect(timeline).toEqual([]);
    expect(stderr.text()).toContain('WRANGLER_VERSION');
  });

  test('INFISICAL_TOKENが無ければ、先にログインするよう示して購読に触れずに失敗する', async () => {
    const { code, timeline, stderr } = await runWith(['--env', 'prod'], {
      env: {},
    });

    expect(code).toBe(EXIT_FAILURE);
    expect(timeline).toEqual([`run:${VERSION_LINE}`]);
    expect(stderr.text()).toContain('infisical-login --scope prod');
  });

  test('/ci/cloudflareにCloudflareのトークンが無ければ、購読に触れずに失敗する', async () => {
    const { code, calls, stderr } = await runWith(['--env', 'staging'], {
      folders: { [folderKeyOf('staging', '/ci/cloudflare')]: [] },
    });

    expect(code).toBe(EXIT_FAILURE);
    expect(calls.map(commandLineOf)).toEqual([VERSION_LINE]);
    expect(stderr.text()).toContain('CLOUDFLARE_API_TOKEN');
  });

  test('資源一覧を読めなければ、何も実行せずに失敗する', async () => {
    const { code, timeline, stderr } = await runWith(['--env', 'staging'], {
      texts: { Dockerfile: DOCKERFILE },
    });

    expect(code).toBe(EXIT_FAILURE);
    expect(timeline).toEqual([]);
    expect(stderr.text()).toContain('apps/infra/environments/staging.json');
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
