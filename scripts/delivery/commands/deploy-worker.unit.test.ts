import { describe, expect, test } from 'bun:test';

import type { CommandSpec } from '../adapters/command-runner.ts';
import { DEPLOY_ENVIRONMENTS } from '../catalog/resource-catalog.ts';
import { commandLineOf } from '../test-fixtures/command-runner.ts';
import {
  API_FOLDER,
  BUNDLED_SCRIPT_ARGS,
  CLIENT_VERSION_ID,
  CLOUDFLARE_CHILD_ENV,
  CLOUDFLARE_FOLDER,
  CLOUDFLARE_TOKEN,
  EVENT_FOLDER,
  EXPECTED_SECRETS,
  FAKE_REPO_ROOT,
  GITHUB_ENV,
  PREVIOUS_SHA,
  SHA,
  SHARED_FOLDER,
  VERSION_ID,
  type RunOptions,
  bundleLineOf,
  bundledDeployLineOf,
  deployArgsOf,
  exportOf,
  foldersOf,
  maskedBefore,
  removeMapsLineOf,
  runWith,
  secretsVisibleInArgsOf,
  shownSecretsOf,
  statusStdoutOf,
  stepOf,
  textsOf,
  viewStdoutOf,
} from '../test-fixtures/deploy-worker.ts';
import { folderKeyOf } from '../test-fixtures/infisical.ts';
import { rejectionMessageOf } from '../test-fixtures/rejection.ts';
import { ACCOUNT_ID } from '../test-fixtures/resource-catalog.ts';
import { command } from './deploy-worker.ts';
import {
  EXIT_FAILURE,
  EXIT_SUCCESS,
  UsageError,
} from './shared/delivery-command.ts';

const expectNoSecretShown = (shown: string): void => {
  expect(shownSecretsOf(shown)).toEqual([]);
};

const expectSecretsOnlyInStdin = (calls: readonly CommandSpec[]): void => {
  expect(secretsVisibleInArgsOf(calls)).toEqual([]);
};

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
            exportOf(env, '/ci/sentry'),
          ],
        );
        const deploys = calls.filter((spec) => stepOf(spec) === 'deploy');
        expect(deploys).toHaveLength(1);
        expect(calls.at(-1)).toBe(deploys[0]);
        const [deploy] = deploys;
        expect(deploy?.command).toBe('bun');
        expect(deploy?.args).toEqual(
          deployArgsOf(['--env', env], BUNDLED_SCRIPT_ARGS),
        );
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
          [
            exportOf(env, '/ci/cloudflare'),
            exportOf(env, '/'),
            exportOf(env, '/ci/sentry'),
          ],
        );
        expect(calls.map((spec) => commandLineOf(spec))).toEqual([
          'bun run build',
          removeMapsLineOf(app),
          ['bun', ...deployArgsOf([])].join(' '),
        ]);
        const [build, , deploy] = calls;
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
        bundleLineOf(env),
        bundledDeployLineOf(env),
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
          .filter(
            (step) =>
              step !== 'build' &&
              step !== 'bundle' &&
              step !== 'remove-maps' &&
              step !== 'deploy',
          ),
      ).toEqual([]);
    },
  );

  const NO_PREVIOUS_ALLOWLIST = 'bun run graphql:allowlist';
  const API_BUNDLE = bundleLineOf('staging');
  const API_DEPLOY = bundledDeployLineOf('staging');
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
        API_BUNDLE,
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
      '$ (apps/api) bun x wrangler deploy .wrangler/sourcemaps/index.js --no-bundle --env staging',
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
          [folderKeyOf('staging', '/workers/event')]: EVENT_FOLDER.filter(
            ({ key }) => key !== 'EMAIL_SMOKE_TOKEN',
          ),
        }),
      },
    );

    expect(code).toBe(EXIT_SUCCESS);
    const deploy = calls.find((spec) => stepOf(spec) === 'deploy');
    const secrets = JSON.parse(deploy?.stdin ?? '') as Record<string, string>;
    expect(Object.keys(secrets).toSorted()).toEqual([
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
