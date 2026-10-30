import { describe, expect, test } from 'bun:test';

import type { CommandRunner, CommandSpec } from '../adapters/command-runner.ts';
import {
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
  withoutPath,
} from '../test-fixtures/repo-files.ts';
import {
  PLACEHOLDER_UUID,
  PROJECT_ID,
} from '../test-fixtures/resource-catalog.ts';
import { command } from './reconcile-ids.ts';
import { EXIT_FAILURE, EXIT_SUCCESS } from './shared/delivery-command.ts';

const TOFU_FOLDER: readonly SecretEntry[] = [
  { key: 'AWS_ACCESS_KEY_ID', value: 'fake-state-access-key-id' },
  { key: 'AWS_SECRET_ACCESS_KEY', value: 'fake-state-secret-access-key' },
  { key: 'TF_VAR_state_passphrase', value: 'fake-state-passphrase-value' },
];

const STATE_ENV: Readonly<Record<string, string>> = Object.fromEntries(
  TOFU_FOLDER.map(({ key, value }) => [key, value]),
);

const SENSITIVE_OUTPUT_VALUE = 'fake-sensitive-output-value';

const SECRET_VALUES: readonly string[] = [
  ...TOFU_FOLDER.map(({ value }) => value),
  SENSITIVE_OUTPUT_VALUE,
];

const D1_ID = '3f9c2b1a-6d4e-4f8a-9b7c-1e2d3c4b5a69';
const SITEKEY = '0x4AAAAAAAB1c2D3e4F5g6H7';
const ANALYTICS_TOKEN = 'fake-web-analytics-site-token';
const PLACEHOLDER_SITEKEY = '0x0000000000000000000000';

const LIVE = '-chdir=apps/infra/live';

const OUTPUTS_JSON = JSON.stringify({
  hidden: { sensitive: true, type: 'string', value: SENSITIVE_OUTPUT_VALUE },
  resource_ids: {
    sensitive: false,
    type: ['object', {}],
    value: {
      d1: { main: D1_ID },
      turnstile_sitekey: SITEKEY,
      web_analytics_site_token: ANALYTICS_TOKEN,
    },
  },
});

interface WranglerIds {
  readonly d1Id: string;
  readonly sitekey: string;
}

const envSectionOf = (
  worker: WorkerKey,
  env: DeployEnvironment,
  { d1Id, sitekey }: WranglerIds,
): string => {
  switch (worker) {
    case 'api':
    case 'event': {
      return `{ "d1_databases": [{ "binding": "DB", "database_name": "app-${env}", "database_id": "${d1Id}" }] }`;
    }
    case 'client': {
      return `{ "vars": { "TURNSTILE_SITE_KEY": "${sitekey}", "WEB_ANALYTICS_TOKEN": "${ANALYTICS_TOKEN}" } }`;
    }
    case 'admin': {
      return `{ "vars": { "TURNSTILE_SITE_KEY": "${sitekey}" } }`;
    }
  }
};

const wranglerJsoncOf = (worker: WorkerKey, ids: WranglerIds): string => `{
  "name": "app-${worker}",
  // 環境ごとの識別子
  "env": {
    "staging": ${envSectionOf(worker, 'staging', ids)},
    "prod": ${envSectionOf(worker, 'prod', ids)},
  },
}
`;

const wranglerFileOf = (worker: WorkerKey): string =>
  `apps/${worker}/wrangler.jsonc`;

const textsOf = (
  ids: WranglerIds = { d1Id: D1_ID, sitekey: SITEKEY },
): Record<string, string> => ({
  ...infisicalRepoTexts(),
  ...Object.fromEntries(
    WORKER_KEYS.map((worker) => [
      wranglerFileOf(worker),
      wranglerJsoncOf(worker, ids),
    ]),
  ),
});

type Step = 'init' | 'output';

const stepOf = (spec: CommandSpec): Step | undefined =>
  (['init', 'output'] as const).find((step) => spec.args[1] === step);

interface RunOptions {
  readonly env?: Readonly<Record<string, string>>;
  readonly texts?: Readonly<Record<string, string>>;
  readonly failAt?: Step;
  readonly outputsJson?: string;
}

const runWith = async (
  args: readonly string[],
  {
    env = { INFISICAL_TOKEN: 'fake-access-token' },
    texts = textsOf(),
    failAt,
    outputsJson = OUTPUTS_JSON,
  }: RunOptions = {},
) => {
  const timeline: string[] = [];
  const calls: CommandSpec[] = [];
  const fake = createFakeDeps(createFakeRepoFiles(texts));
  const runner: CommandRunner = {
    run: (spec) => {
      calls.push(spec);
      timeline.push(`run:${commandLineOf(spec)}`);
      const step = stepOf(spec);
      const failed = failAt !== undefined && step === failAt;
      return Promise.resolve({
        code: failed ? 1 : 0,
        stdout: step === 'output' ? outputsJson : '',
        stderr: failed ? `Error: ${failAt}の診断のメッセージ\n` : '',
      });
    },
    start: () => {
      throw new Error('常駐の起動は使わない');
    },
  };
  const folders = {
    [folderKeyOf('staging', '/ci/tofu')]: TOFU_FOLDER,
    [folderKeyOf('prod', '/ci/tofu')]: TOFU_FOLDER,
  };
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

const expectNoSecretShown = (shown: string): void => {
  for (const value of SECRET_VALUES) expect(shown).not.toContain(value);
};

describe('reconcile-ids', () => {
  test('名前と説明を持つ', () => {
    expect(command.name).toBe('reconcile-ids');
    expect(command.description).not.toBe('');
  });

  test('/ci/tofuの値をマスクしてから、初期化→全ての出力のJSONの取り込みの順に呼ぶ', async () => {
    const { code, timeline, calls } = await runWith(['--env', 'staging']);

    expect(code).toBe(EXIT_SUCCESS);
    expect(timeline.filter((event) => !event.startsWith('summary:'))).toEqual([
      `export:${PROJECT_ID}:staging:/ci/tofu:${CATALOG_HOST}`,
      'mask:fake-state-access-key-id',
      'mask:fake-state-secret-access-key',
      'mask:fake-state-passphrase-value',
      `run:tofu ${LIVE} init -input=false -reconfigure -backend-config=../backends/staging.s3.hcl`,
      `run:tofu ${LIVE} output -json -no-color`,
    ]);
    expect(calls.every((spec) => spec.cwd === FAKE_REPO_ROOT)).toBe(true);
    expect(calls.map(({ env }) => env)).toEqual([STATE_ENV, STATE_ENV]);
    expect(calls.map(({ output }) => output)).toEqual(['inherit', 'capture']);
  });

  test('全ての識別子が一致すれば、その旨を表示と手順の要約に書いて成功する', async () => {
    const { code, stdout, summaries, shown } = await runWith([
      '--env',
      'staging',
    ]);

    expect(code).toBe(EXIT_SUCCESS);
    expect(stdout.text()).toContain(
      '資源の識別子の照合(staging): 識別子の食い違いはありません。\n',
    );
    expect(summaries).toEqual([
      '### 資源の識別子の照合(staging)\n\n識別子の食い違いはありません。\n',
    ]);
    expectNoSecretShown(shown);
  });

  test('Wrangler設定が仮の値なら、ファイル・項目・現在の値・反映すべき値の表を出して終了コード1を返し、秘密値を表示しない', async () => {
    const { code, stderr, summaries, shown } = await runWith(
      ['--env', 'staging'],
      {
        texts: textsOf({
          d1Id: PLACEHOLDER_UUID,
          sitekey: PLACEHOLDER_SITEKEY,
        }),
      },
    );

    expect(code).toBe(EXIT_FAILURE);
    const report = stderr.text();
    expect(report).toContain(
      '資源の識別子の照合(staging): 識別子の食い違いが4件あります。',
    );
    expect(report).toContain('ファイル');
    expect(report).toContain('反映すべき値');
    expect(report).toMatch(
      /apps\/api\/wrangler\.jsonc\s+env\.staging\.d1_databases\[DB\]\.database_id\s+0{8}-0{4}-0{4}-0{4}-0{12}\s+3f9c2b1a-6d4e-4f8a-9b7c-1e2d3c4b5a69/,
    );
    expect(report).toMatch(
      /apps\/event\/wrangler\.jsonc\s+env\.staging\.d1_databases\[DB\]\.database_id/,
    );
    expect(report).toMatch(
      /apps\/client\/wrangler\.jsonc\s+env\.staging\.vars\.TURNSTILE_SITE_KEY\s+0x0{22}\s+0x4AAAAAAAB1c2D3e4F5g6H7/,
    );
    expect(report).toMatch(
      /apps\/admin\/wrangler\.jsonc\s+env\.staging\.vars\.TURNSTILE_SITE_KEY/,
    );
    expect(report).not.toContain('WEB_ANALYTICS_TOKEN');
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toContain(
      '| apps/client/wrangler.jsonc | env.staging.vars.TURNSTILE_SITE_KEY | 0x0000000000000000000000 | 0x4AAAAAAAB1c2D3e4F5g6H7 |',
    );
    expectNoSecretShown(shown);
  });

  test('prodでは資源一覧のprodの主体・prodの/ci/tofu・prodのbackend設定・Wrangler設定のprodの節を使う', async () => {
    const { code, timeline, calls, stderr } = await runWith(['--env', 'prod'], {
      texts: textsOf({ d1Id: PLACEHOLDER_UUID, sitekey: SITEKEY }),
    });

    expect(code).toBe(EXIT_FAILURE);
    expect(timeline[0]).toBe(
      `export:${PROJECT_ID}:prod:/ci/tofu:${CATALOG_HOST}`,
    );
    expect(calls[0]?.args).toContain('-backend-config=../backends/prod.s3.hcl');
    expect(stderr.text()).toContain('env.prod.d1_databases[DB].database_id');
  });

  test('出力を読み取れなければ、値を示さずに誤りを表示して終了コード1を返す', async () => {
    const { code, stderr, shown } = await runWith(['--env', 'staging'], {
      outputsJson: JSON.stringify({
        resource_ids: {
          sensitive: true,
          type: 'string',
          value: SENSITIVE_OUTPUT_VALUE,
        },
      }),
    });

    expect(code).toBe(EXIT_FAILURE);
    expect(stderr.text()).toBe(
      'reconcile-ids: OpenTofuの出力resource_idsがsensitiveのため読み取りません。outputs.tfで秘密でない識別子だけを出力してください\n',
    );
    expectNoSecretShown(shown);
  });

  test.each([
    ['init', ['init']],
    ['output', ['init', 'output']],
  ] as const)(
    '%sが失敗したら照合せず、失敗した手順と診断を表示して終了コード1を返す',
    async (failAt, expectedSteps) => {
      const { code, calls, stderr, summaries, shown } = await runWith(
        ['--env', 'staging'],
        { failAt },
      );

      expect(code).toBe(EXIT_FAILURE);
      expect(calls.map(stepOf)).toEqual([...expectedSteps]);
      expect(stderr.text()).toContain(`reconcile-ids: tofu ${LIVE} ${failAt}`);
      expect(stderr.text()).toContain('が終了コード1で失敗しました。');
      expect(summaries).toEqual([]);
      expectNoSecretShown(shown);
    },
  );

  test('Wrangler設定を読み込めなければ、シークレットを取り出さず子プロセスも起動せずに入力の誤りとして失敗する', async () => {
    const { code, timeline, calls, stderr } = await runWith(
      ['--env', 'staging'],
      { texts: withoutPath(textsOf(), 'apps/admin/wrangler.jsonc') },
    );

    expect(code).toBe(EXIT_FAILURE);
    expect(calls).toEqual([]);
    expect(timeline.some((event) => event.startsWith('export:'))).toBe(false);
    expect(stderr.text()).toContain(
      '資源の識別子の照合(staging): 検査の入力を読み込めません。',
    );
    expect(stderr.text()).toContain('apps/admin/wrangler.jsonc');
  });

  test('資源一覧を読み込めなければ、子プロセスを起動せずに入力の誤りとして失敗する', async () => {
    const { code, calls, stderr } = await runWith(['--env', 'staging'], {
      texts: withoutPath(textsOf(), 'apps/infra/environments/staging.json'),
    });

    expect(code).toBe(EXIT_FAILURE);
    expect(calls).toEqual([]);
    expect(stderr.text()).toContain(
      '資源の識別子の照合(staging): 検査の入力を読み込めません。',
    );
    expect(stderr.text()).toContain('apps/infra/environments/staging.json');
  });

  test('INFISICAL_TOKENが無ければ、子プロセスを起動せずに失敗する', async () => {
    const { code, calls, stderr } = await runWith(['--env', 'staging'], {
      env: {},
    });

    expect(code).toBe(EXIT_FAILURE);
    expect(calls).toEqual([]);
    expect(stderr.text()).toBe(
      'reconcile-ids: INFISICAL_TOKENがありません。先に`infisical-login --scope staging`を実行してください。\n',
    );
  });

  test('環境の指定が無ければ使い方の誤りにする', async () => {
    const fake = createFakeDeps(createFakeRepoFiles(textsOf()));

    expect(await rejectionMessageOf(command.run([], fake.deps))).toContain(
      '--env',
    );
  });
});
