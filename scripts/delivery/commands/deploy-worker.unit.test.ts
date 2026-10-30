import { describe, expect, test } from 'bun:test';

import type { CommandRunner, CommandSpec } from '../adapters/command-runner.ts';
import {
  DEPLOY_ENVIRONMENTS,
  type DeployEnvironment,
  WORKER_KEYS,
  type WorkerKey,
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
import { command } from './deploy-worker.ts';
import {
  EXIT_FAILURE,
  EXIT_SUCCESS,
  UsageError,
} from './shared/delivery-command.ts';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const RUN_URL = 'https://github.example/example/launch/actions/runs/42';
const GITHUB_ENV: Readonly<Record<string, string>> = {
  INFISICAL_TOKEN: 'fake-access-token',
  GITHUB_SHA: SHA,
  GITHUB_SERVER_URL: 'https://github.example',
  GITHUB_REPOSITORY: 'example/launch',
  GITHUB_RUN_ID: '42',
};

const VERSION_ID = '01234567-89ab-4cde-8f01-23456789abcd';
const DEPLOY_STDOUT = [
  'Total Upload: 512.34 KiB / gzip: 120.11 KiB',
  'Worker Startup Time: 23 ms',
  'Your Worker has access to the following bindings:',
  'env.APP_ENVIRONMENT ("staging")      Environment Variable',
  'Uploaded app-worker (5.12 sec)',
  `Current Version ID: ${VERSION_ID}`,
  '',
].join('\n');

const CLOUDFLARE_TOKEN = 'fake-cloudflare-api-token';
const CLOUDFLARE_CHILD_ENV = {
  CLOUDFLARE_API_TOKEN: CLOUDFLARE_TOKEN,
  CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
};

const CLOUDFLARE_FOLDER: readonly SecretEntry[] = [
  { key: 'CLOUDFLARE_API_TOKEN', value: CLOUDFLARE_TOKEN },
];

const SHARED_FOLDER: readonly SecretEntry[] = [
  { key: 'HASH_PEPPER', value: 'fake-shared-pepper' },
  { key: 'SENTRY_DSN', value: 'fake-shared-sentry-dsn' },
  { key: 'STRIPE_API_KEY', value: 'fake-shared-stripe-key' },
  { key: 'DISIFY_API_KEY', value: 'fake-shared-disify-key' },
  { key: 'PRIVATE_KEY', value: 'fake-key-line-1\nfake-key-line-2' },
  { key: 'UNDECLARED_SECRET', value: 'fake-undeclared-value' },
];

const API_FOLDER: readonly SecretEntry[] = [
  { key: 'STRIPE_API_KEY', value: 'fake-api-stripe-key' },
  { key: 'SENTRY_DSN', value: 'fake-api-sentry-dsn' },
];

const EVENT_FOLDER: readonly SecretEntry[] = [
  { key: 'STRIPE_API_KEY', value: 'fake-event-stripe-key' },
  { key: 'EMAIL_SMOKE_TOKEN', value: 'fake-event-smoke-token' },
];

const foldersOf = (
  env: DeployEnvironment,
  overrides: Readonly<Record<string, readonly SecretEntry[] | undefined>> = {},
): Record<string, readonly SecretEntry[]> =>
  Object.fromEntries(
    Object.entries({
      [folderKeyOf(env, '/ci/cloudflare')]: CLOUDFLARE_FOLDER,
      [folderKeyOf(env, '/')]: SHARED_FOLDER,
      [folderKeyOf(env, '/workers/api')]: API_FOLDER,
      [folderKeyOf(env, '/workers/event')]: EVENT_FOLDER,
      ...overrides,
    }).filter(
      (entry): entry is [string, readonly SecretEntry[]] =>
        entry[1] !== undefined,
    ),
  );

const WORKER_SECRET_VALUES: readonly string[] = [
  ...SHARED_FOLDER,
  ...API_FOLDER,
  ...EVENT_FOLDER,
].flatMap(({ value }) => value.split('\n'));

const ALL_SECRET_VALUES: readonly string[] = [
  CLOUDFLARE_TOKEN,
  ...WORKER_SECRET_VALUES,
];

const REQUIRED_SECRETS: Readonly<Record<WorkerKey, readonly string[]>> = {
  api: ['HASH_PEPPER', 'SENTRY_DSN', 'STRIPE_API_KEY'],
  event: ['HASH_PEPPER', 'PRIVATE_KEY', 'STRIPE_API_KEY'],
  client: ['HASH_PEPPER', 'SENTRY_DSN'],
  admin: ['HASH_PEPPER'],
};

const EXPECTED_SECRETS: Readonly<
  Record<WorkerKey, Readonly<Record<string, string>>>
> = {
  api: {
    HASH_PEPPER: 'fake-shared-pepper',
    SENTRY_DSN: 'fake-api-sentry-dsn',
    STRIPE_API_KEY: 'fake-api-stripe-key',
    DISIFY_API_KEY: 'fake-shared-disify-key',
  },
  event: {
    HASH_PEPPER: 'fake-shared-pepper',
    PRIVATE_KEY: 'fake-key-line-1\nfake-key-line-2',
    STRIPE_API_KEY: 'fake-event-stripe-key',
    EMAIL_SMOKE_TOKEN: 'fake-event-smoke-token',
    DISIFY_API_KEY: 'fake-shared-disify-key',
  },
  client: {
    HASH_PEPPER: 'fake-shared-pepper',
    SENTRY_DSN: 'fake-shared-sentry-dsn',
  },
  admin: { HASH_PEPPER: 'fake-shared-pepper' },
};

const wranglerJsoncOf = (
  worker: WorkerKey,
  required: readonly string[] = REQUIRED_SECRETS[worker],
): string => {
  const section = JSON.stringify({ secrets: { required } });
  return `{
  "name": "app-${worker}",
  // ローカルの必須のシークレットは環境ごとの節に引き継がれない
  "secrets": { "required": ["LOCAL_ONLY_SECRET"] },
  "env": { "staging": ${section}, "prod": ${section} },
}
`;
};

const textsOf = (
  required: Partial<Record<WorkerKey, readonly string[]>> = {},
): Record<string, string> => ({
  ...infisicalRepoTexts(),
  ...Object.fromEntries(
    WORKER_KEYS.map((worker) => [
      `apps/${worker}/wrangler.jsonc`,
      wranglerJsoncOf(worker, required[worker]),
    ]),
  ),
});

const PREVIOUS_SHA = '89abcdef0123456789abcdef0123456789abcdef';
const CLIENT_VERSION_ID = '00000000-0000-4000-8000-000000000001';

const statusStdoutOf = (
  versions: readonly {
    readonly version_id: string;
    readonly percentage: number;
  }[],
): string =>
  `${JSON.stringify(
    {
      id: '00000000-0000-4000-8000-000000000002',
      created_on: '2026-10-29T00:00:00.000000Z',
      source: 'wrangler',
      strategy: 'percentage',
      author_email: 'ci@launch.example',
      versions,
    },
    null,
    2,
  )}\n`;

const STATUS_STDOUT = statusStdoutOf([
  { version_id: CLIENT_VERSION_ID, percentage: 100 },
]);

const viewStdoutOf = (annotations: Readonly<Record<string, string>>): string =>
  `${JSON.stringify(
    {
      id: CLIENT_VERSION_ID,
      number: 3,
      metadata: { created_on: '2026-10-29T00:00:00.000000Z' },
      annotations,
    },
    null,
    2,
  )}\n`;

const VIEW_STDOUT = viewStdoutOf({
  'workers/tag': PREVIOUS_SHA,
  'workers/message': `${PREVIOUS_SHA} ${RUN_URL}`,
});

type Step = 'build' | 'deploy' | 'status' | 'view' | 'git' | 'allowlist';

const stepOf = (spec: CommandSpec): Step | undefined => {
  if (spec.command === 'git') return 'git';
  const line = spec.args.join(' ');
  if (line === 'run build') return 'build';
  if (line.startsWith('run graphql:allowlist')) return 'allowlist';
  if (line.startsWith('x wrangler deployments status')) return 'status';
  if (line.startsWith('x wrangler versions view')) return 'view';
  return spec.args.includes('deploy') ? 'deploy' : undefined;
};

interface RunOptions {
  readonly env?: Readonly<Record<string, string>>;
  readonly folders?: Readonly<Record<string, readonly SecretEntry[]>>;
  readonly texts?: Readonly<Record<string, string>>;
  readonly failAt?: Step;
  readonly deployStdout?: string;
  readonly statusStdout?: string;
  readonly viewStdout?: string;
}

const runWith = async (
  args: readonly string[],
  {
    env = GITHUB_ENV,
    folders = foldersOf('staging'),
    texts = textsOf(),
    failAt,
    deployStdout = DEPLOY_STDOUT,
    statusStdout = STATUS_STDOUT,
    viewStdout = VIEW_STDOUT,
  }: RunOptions = {},
) => {
  const timeline: string[] = [];
  const calls: CommandSpec[] = [];
  const stdoutOf: Partial<Record<Step, string>> = {
    deploy: deployStdout,
    status: statusStdout,
    view: viewStdout,
  };
  const runner: CommandRunner = {
    run: (spec) => {
      calls.push(spec);
      timeline.push(`run:${commandLineOf(spec)}`);
      const step = stepOf(spec);
      const failed = failAt !== undefined && step === failAt;
      return Promise.resolve({
        code: failed ? 1 : 0,
        stdout: failed || step === undefined ? '' : (stdoutOf[step] ?? ''),
        stderr: failed ? `✘ [ERROR] ${failAt}の失敗の診断\n` : '',
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
  const summaries = timeline
    .filter((event) => event.startsWith('summary:'))
    .map((event) => event.slice('summary:'.length));
  const shown = [fake.stdout.text(), fake.stderr.text(), ...summaries].join(
    '\n',
  );
  return { ...fake, code, timeline, calls, shown, summaries };
};

const exportOf = (env: DeployEnvironment, folder: string): string =>
  `export:${PROJECT_ID}:${env}:${folder}:${CATALOG_HOST}`;

const deployArgsOf = (envArgs: readonly string[]): readonly string[] => [
  'x',
  'wrangler',
  'deploy',
  ...envArgs,
  '--tag',
  SHA,
  '--message',
  `${SHA} ${RUN_URL}`,
  '--secrets-file',
  '/dev/stdin',
];

const expectNoSecretShown = (shown: string): void => {
  for (const value of ALL_SECRET_VALUES) expect(shown).not.toContain(value);
};

const expectSecretsOnlyInStdin = (calls: readonly CommandSpec[]): void => {
  for (const spec of calls) {
    const visible = [
      ...spec.args,
      ...Object.entries(spec.env ?? {})
        .filter(([key]) => key !== 'CLOUDFLARE_API_TOKEN')
        .flat(),
    ].join('\n');
    for (const value of WORKER_SECRET_VALUES) {
      expect(visible).not.toContain(value);
    }
  }
};

const maskedBefore = (timeline: readonly string[], index: number) =>
  timeline
    .slice(0, index)
    .filter((event) => event.startsWith('mask:'))
    .map((event) => event.slice('mask:'.length));

describe('deploy-worker', () => {
  test('名前と説明を持つ', () => {
    expect(command.name).toBe('deploy-worker');
    expect(command.description).not.toBe('');
  });

  describe.each(DEPLOY_ENVIRONMENTS)('%s', (env) => {
    test.each(['api', 'event'] as const)(
      '%sは、資源一覧の主体で共通とWorkerごとのフォルダを取り出し、宣言したシークレットを標準入力だけで渡して、環境・コミットのタグ・実行のURLを持つメッセージを指定してデプロイする',
      async (app) => {
        const { code, timeline, calls, shown } = await runWith(
          ['--env', env, '--app', app],
          { folders: foldersOf(env) },
        );

        expect(code).toBe(EXIT_SUCCESS);
        expect(timeline.filter((event) => event.startsWith('export:'))).toEqual(
          [
            exportOf(env, '/ci/cloudflare'),
            exportOf(env, '/'),
            exportOf(env, `/workers/${app}`),
          ],
        );
        const deploys = calls.filter((spec) => stepOf(spec) === 'deploy');
        expect(deploys).toHaveLength(1);
        expect(calls.at(-1)).toBe(deploys[0]);
        const [deploy] = deploys;
        expect(deploy?.command).toBe('bun');
        expect(deploy?.args).toEqual(deployArgsOf(['--env', env]));
        expect(deploy?.cwd).toBe(`${FAKE_REPO_ROOT}/apps/${app}`);
        expect(deploy?.env).toEqual(CLOUDFLARE_CHILD_ENV);
        expect(deploy?.output).toBe('capture');
        expect(JSON.parse(deploy?.stdin ?? '')).toEqual(EXPECTED_SECRETS[app]);
        expectSecretsOnlyInStdin(calls);
        expectNoSecretShown(shown);
      },
    );

    test.each(['client', 'admin'] as const)(
      '%sは、環境を指定してビルドした後に、環境を指定せずビルドの設定でデプロイする',
      async (app) => {
        const { code, timeline, calls, shown } = await runWith(
          ['--env', env, '--app', app],
          { folders: foldersOf(env) },
        );

        expect(code).toBe(EXIT_SUCCESS);
        expect(timeline.filter((event) => event.startsWith('export:'))).toEqual(
          [exportOf(env, '/ci/cloudflare'), exportOf(env, '/')],
        );
        expect(calls.map((spec) => commandLineOf(spec))).toEqual([
          'bun run build',
          ['bun', ...deployArgsOf([])].join(' '),
        ]);
        const [build, deploy] = calls;
        expect(build?.cwd).toBe(`${FAKE_REPO_ROOT}/apps/${app}`);
        expect(build?.env).toEqual({
          CLOUDFLARE_ENV: env,
          CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
        });
        expect(build?.stdin).toBeUndefined();
        expect(build?.output).toBe('inherit');
        expect(deploy?.cwd).toBe(`${FAKE_REPO_ROOT}/apps/${app}`);
        expect(deploy?.env).toEqual(CLOUDFLARE_CHILD_ENV);
        expect(deploy?.output).toBe('capture');
        expect(JSON.parse(deploy?.stdin ?? '')).toEqual(EXPECTED_SECRETS[app]);
        expectSecretsOnlyInStdin(calls);
        expectNoSecretShown(shown);
      },
    );

    test('apiは、clientのWorkerの版の状態と版の情報を読み、コミットの存在を確かめてから直前のコミットを渡して許可リストを生成し、その後にデプロイする', async () => {
      const { code, calls, stdout, shown } = await runWith(
        ['--env', env, '--app', 'api'],
        { folders: foldersOf(env) },
      );

      expect(code).toBe(EXIT_SUCCESS);
      expect(calls.map((spec) => commandLineOf(spec))).toEqual([
        `bun x wrangler deployments status --name app-client-${env} --json`,
        `bun x wrangler versions view ${CLIENT_VERSION_ID} --name app-client-${env} --json`,
        `git cat-file -e ${PREVIOUS_SHA}^{commit}`,
        `bun run graphql:allowlist --previous-ref ${PREVIOUS_SHA}`,
        ['bun', ...deployArgsOf(['--env', env])].join(' '),
      ]);
      const [status, view, git, allowlist] = calls;
      for (const spec of [status, view]) {
        expect(spec?.cwd).toBe(`${FAKE_REPO_ROOT}/apps/client`);
        expect(spec?.env).toEqual(CLOUDFLARE_CHILD_ENV);
        expect(spec?.output).toBe('capture');
        expect(spec?.stdin).toBeUndefined();
      }
      expect(git?.cwd).toBe(FAKE_REPO_ROOT);
      expect(git?.output).toBe('capture');
      expect(allowlist?.cwd).toBe(`${FAKE_REPO_ROOT}/apps/api`);
      expect(allowlist?.env).toBeUndefined();
      expect(allowlist?.output).toBe('inherit');
      expect(stdout.text()).toContain(PREVIOUS_SHA);
      expect(stdout.text()).toContain(CLIENT_VERSION_ID);
      expectSecretsOnlyInStdin(calls);
      expectNoSecretShown(shown);
    });
  });

  test.each(['event', 'client', 'admin'] as const)(
    '%sは、clientのWorkerの版を読まず、許可リストも生成しない',
    async (app) => {
      const { code, calls } = await runWith(['--env', 'staging', '--app', app]);

      expect(code).toBe(EXIT_SUCCESS);
      expect(
        calls
          .map((spec) => stepOf(spec))
          .filter((step) => step !== 'build' && step !== 'deploy'),
      ).toEqual([]);
    },
  );

  const NO_PREVIOUS_ALLOWLIST = 'bun run graphql:allowlist';
  const API_DEPLOY = ['bun', ...deployArgsOf(['--env', 'staging'])].join(' ');
  const STATUS_LINE =
    'bun x wrangler deployments status --name app-client-staging --json';
  const VIEW_LINE = `bun x wrangler versions view ${CLIENT_VERSION_ID} --name app-client-staging --json`;

  test.each<[string, RunOptions, readonly string[], readonly string[]]>([
    [
      '版の状態を取得できない(初回のデプロイ)',
      { failAt: 'status' },
      [STATUS_LINE],
      ['statusの失敗の診断', '終了コード1'],
    ],
    [
      '分割配信中',
      {
        statusStdout: statusStdoutOf([
          { version_id: CLIENT_VERSION_ID, percentage: 90 },
          {
            version_id: '00000000-0000-4000-8000-000000000003',
            percentage: 10,
          },
        ]),
      },
      [STATUS_LINE],
      ['分割配信', `${CLIENT_VERSION_ID} 90%`],
    ],
    [
      '版の情報を取得できない',
      { failAt: 'view' },
      [STATUS_LINE, VIEW_LINE],
      ['viewの失敗の診断', CLIENT_VERSION_ID],
    ],
    [
      '版にタグが無い',
      { viewStdout: viewStdoutOf({ 'workers/message': 'manual' }) },
      [STATUS_LINE, VIEW_LINE],
      ['タグがありません'],
    ],
    [
      '版のタグがコミットのSHAでない',
      { viewStdout: viewStdoutOf({ 'workers/tag': 'v1.0.0' }) },
      [STATUS_LINE, VIEW_LINE],
      ['v1.0.0', '40桁の16進'],
    ],
    [
      'コミットが履歴に無い',
      { failAt: 'git' },
      [STATUS_LINE, VIEW_LINE, `git cat-file -e ${PREVIOUS_SHA}^{commit}`],
      [PREVIOUS_SHA, '履歴'],
    ],
  ])(
    '%sなら、理由を示す警告を出し、引数なしで許可リストを生成してからデプロイする',
    async (_, options, reads, reasons) => {
      const { code, calls, stderr, summaries, shown } = await runWith(
        ['--env', 'staging', '--app', 'api'],
        options,
      );

      expect(code).toBe(EXIT_SUCCESS);
      expect(calls.map((spec) => commandLineOf(spec))).toEqual([
        ...reads,
        NO_PREVIOUS_ALLOWLIST,
        API_DEPLOY,
      ]);
      expect(stderr.text()).toContain('警告');
      expect(stderr.text()).toContain('現行の操作だけ');
      for (const reason of reasons) expect(stderr.text()).toContain(reason);
      const warning = summaries.find((summary) => summary.includes('警告'));
      expect(warning).toBeDefined();
      expect(warning).toContain('現行の操作だけ');
      expectNoSecretShown(shown);
    },
  );

  test('許可リストの生成が失敗したら、APIサーバーをデプロイせずに失敗する', async () => {
    const { code, calls, stderr } = await runWith(
      ['--env', 'staging', '--app', 'api'],
      { failAt: 'allowlist' },
    );

    expect(code).toBe(EXIT_FAILURE);
    expect(calls.map((spec) => stepOf(spec))).toEqual([
      'status',
      'view',
      'git',
      'allowlist',
    ]);
    expect(stderr.text()).toContain(
      `bun run graphql:allowlist --previous-ref ${PREVIOUS_SHA}`,
    );
    expect(stderr.text()).toContain('終了コード1');
  });

  test('取り出したすべてのフォルダの値を、行ごとに最初の子プロセスの起動より先にマスクする', async () => {
    const { timeline } = await runWith(['--env', 'staging', '--app', 'api']);

    const firstRun = timeline.findIndex((event) => event.startsWith('run:'));
    expect(firstRun).toBeGreaterThan(-1);
    expect(maskedBefore(timeline, firstRun).toSorted()).toEqual(
      [
        ...new Set(
          [...CLOUDFLARE_FOLDER, ...SHARED_FOLDER, ...API_FOLDER].flatMap(
            ({ value }) => value.split('\n'),
          ),
        ),
      ].toSorted(),
    );
  });

  test('client・adminもビルドの前にマスクを終える', async () => {
    const { timeline } = await runWith(['--env', 'staging', '--app', 'client']);

    const build = timeline.indexOf('run:bun run build');
    expect(maskedBefore(timeline, build)).toContain('fake-shared-pepper');
    expect(maskedBefore(timeline, build)).toContain(CLOUDFLARE_TOKEN);
  });

  test('デプロイの出力を表示し、版のID・コミット・起動時間を手順の要約に書く', async () => {
    const { code, stdout, summaries } = await runWith([
      '--env',
      'staging',
      '--app',
      'api',
    ]);

    expect(code).toBe(EXIT_SUCCESS);
    expect(stdout.text()).toContain('Worker Startup Time: 23 ms');
    expect(stdout.text()).toContain(
      '$ (apps/api) bun x wrangler deploy --env staging',
    );
    expect(summaries).toHaveLength(1);
    const [summary] = summaries;
    expect(summary).toContain('Workerのデプロイ(staging・api)');
    expect(summary).toContain('app-api-staging');
    expect(summary).toContain(VERSION_ID);
    expect(summary).toContain(SHA);
    expect(summary).toContain('23 ms');
  });

  test('出力から版のIDと起動時間を読めなければ、警告を出して要約に読めなかったことを書き、成功で終わる', async () => {
    const { code, stderr, summaries } = await runWith(
      ['--env', 'staging', '--app', 'api'],
      { deployStdout: 'Uploaded app-api-staging (5.12 sec)\n' },
    );

    expect(code).toBe(EXIT_SUCCESS);
    expect(stderr.text()).toContain('版のID');
    expect(stderr.text()).toContain('起動時間');
    expect(summaries.join('\n')).toContain('(読み取れませんでした)');
  });

  test('必須のシークレットが欠けていれば、欠けたキーの名前だけを出して、子プロセスを起動せずに失敗する', async () => {
    const { code, calls, stderr, shown, summaries } = await runWith(
      ['--env', 'staging', '--app', 'api'],
      {
        texts: textsOf({
          api: ['HASH_PEPPER', 'TURNSTILE_SECRET_KEY', 'SENTRY_DSN'],
        }),
      },
    );

    expect(code).toBe(EXIT_FAILURE);
    expect(calls).toEqual([]);
    expect(stderr.text()).toContain('TURNSTILE_SECRET_KEY');
    expect(stderr.text()).not.toContain('HASH_PEPPER');
    expect(summaries.join('\n')).toContain('TURNSTILE_SECRET_KEY');
    expectNoSecretShown(shown);
  });

  test('Workerごとに分けると定めたキーが共通のフォルダにしか無ければ、欠落として失敗する', async () => {
    const { code, calls, stderr, shown } = await runWith(
      ['--env', 'staging', '--app', 'api'],
      {
        folders: foldersOf('staging', {
          [folderKeyOf('staging', '/workers/api')]: [],
        }),
      },
    );

    expect(code).toBe(EXIT_FAILURE);
    expect(calls).toEqual([]);
    expect(stderr.text()).toContain('STRIPE_API_KEY');
    expectNoSecretShown(shown);
  });

  test('任意のシークレットは在る場合だけ渡す', async () => {
    const { code, calls } = await runWith(
      ['--env', 'staging', '--app', 'event'],
      {
        folders: foldersOf('staging', {
          [folderKeyOf('staging', '/')]: SHARED_FOLDER.filter(
            ({ key }) => key !== 'DISIFY_API_KEY',
          ),
        }),
      },
    );

    expect(code).toBe(EXIT_SUCCESS);
    const secrets = JSON.parse(calls[0]?.stdin ?? '') as Record<string, string>;
    expect(Object.keys(secrets).toSorted()).toEqual([
      'EMAIL_SMOKE_TOKEN',
      'HASH_PEPPER',
      'PRIVATE_KEY',
      'STRIPE_API_KEY',
    ]);
  });

  test('デプロイが失敗したら、取り込んだ出力と失敗を表示して失敗する', async () => {
    const { code, stderr, summaries, shown } = await runWith(
      ['--env', 'staging', '--app', 'event'],
      { failAt: 'deploy' },
    );

    expect(code).toBe(EXIT_FAILURE);
    expect(stderr.text()).toContain('deployの失敗の診断');
    expect(stderr.text()).toContain('終了コード1');
    expect(summaries).toEqual([]);
    expectNoSecretShown(shown);
  });

  test('ビルドが失敗したら、デプロイせずに失敗する', async () => {
    const { code, calls, stderr } = await runWith(
      ['--env', 'staging', '--app', 'admin'],
      { failAt: 'build' },
    );

    expect(code).toBe(EXIT_FAILURE);
    expect(calls.map((spec) => commandLineOf(spec))).toEqual(['bun run build']);
    expect(stderr.text()).toContain('bun run build');
  });

  test.each([
    'GITHUB_SHA',
    'GITHUB_SERVER_URL',
    'GITHUB_REPOSITORY',
    'GITHUB_RUN_ID',
  ])(
    '%sが無ければ、シークレットを取り出さずに名前を示して失敗する',
    async (name) => {
      const { code, timeline, stderr } = await runWith(
        ['--env', 'staging', '--app', 'api'],
        {
          env: Object.fromEntries(
            Object.entries(GITHUB_ENV).filter(([key]) => key !== name),
          ),
        },
      );

      expect(code).toBe(EXIT_FAILURE);
      expect(timeline).toEqual([]);
      expect(stderr.text()).toContain(name);
    },
  );

  test('GITHUB_SHAが40桁の16進でなければ失敗する', async () => {
    const { code, timeline, stderr } = await runWith(
      ['--env', 'staging', '--app', 'api'],
      { env: { ...GITHUB_ENV, GITHUB_SHA: 'main' } },
    );

    expect(code).toBe(EXIT_FAILURE);
    expect(timeline).toEqual([]);
    expect(stderr.text()).toContain('GITHUB_SHA');
  });

  test('INFISICAL_TOKENが無ければ、先にログインするよう示して失敗する', async () => {
    const { code, timeline, stderr } = await runWith(
      ['--env', 'prod', '--app', 'api'],
      {
        env: Object.fromEntries(
          Object.entries(GITHUB_ENV).filter(
            ([key]) => key !== 'INFISICAL_TOKEN',
          ),
        ),
      },
    );

    expect(code).toBe(EXIT_FAILURE);
    expect(timeline).toEqual([]);
    expect(stderr.text()).toContain('infisical-login --scope prod');
  });

  test('フォルダを取り出せなければ、フォルダの名前を示して子プロセスを起動せずに失敗する', async () => {
    const { code, calls, stderr } = await runWith(
      ['--env', 'staging', '--app', 'event'],
      {
        folders: foldersOf('staging', {
          [folderKeyOf('staging', '/workers/event')]: undefined,
        }),
      },
    );

    expect(code).toBe(EXIT_FAILURE);
    expect(calls).toEqual([]);
    expect(stderr.text()).toContain('/workers/event');
  });

  test('/ci/cloudflareにCloudflareのトークンが無ければ、キーの名前を示して失敗する', async () => {
    const { code, calls, stderr } = await runWith(
      ['--env', 'staging', '--app', 'api'],
      {
        folders: foldersOf('staging', {
          [folderKeyOf('staging', '/ci/cloudflare')]: [],
        }),
      },
    );

    expect(code).toBe(EXIT_FAILURE);
    expect(calls).toEqual([]);
    expect(stderr.text()).toContain('CLOUDFLARE_API_TOKEN');
    expect(stderr.text()).toContain('/ci/cloudflare');
  });

  test('Wrangler設定を読めなければ、入力の不足として失敗する', async () => {
    const texts = textsOf();
    const { code, timeline, stderr } = await runWith(
      ['--env', 'staging', '--app', 'api'],
      {
        texts: { ...texts, 'apps/api/wrangler.jsonc': '{ "name": "app-api" }' },
      },
    );

    expect(code).toBe(EXIT_FAILURE);
    expect(timeline.filter((event) => event.startsWith('run:'))).toEqual([]);
    expect(stderr.text()).toContain('apps/api/wrangler.jsonc');
  });

  test.each([
    [
      ['--env', 'staging'],
      '--appを指定してください(api・event・client・admin)',
    ],
    [['--app', 'api'], '--envを指定してください(staging・prod)'],
    [
      ['--env', 'staging', '--app', 'web'],
      '--appはapi・event・client・adminのいずれかにしてください(実際: web)',
    ],
    [
      ['--env', 'staging', '--app', 'api', '--', 'echo'],
      '`--`の後のコマンドは受け取りません',
    ],
  ])(
    '引数%pは引数の誤りとして拒否し、何も実行しない',
    async (args, message) => {
      const error = await runWith(args).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UsageError);
      expect(await rejectionMessageOf(runWith(args))).toBe(message);
    },
  );
});
