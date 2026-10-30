import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { type RepoFiles, createRepoFiles } from './adapters/repo-files.ts';
import {
  CHECK_SECRETS_IDENTITY,
  INFISICAL_CONFIG_PATH,
  checkSecretsSettings,
} from './catalog/check-secrets.ts';
import {
  DEPLOY_ENVIRONMENTS,
  type DeployEnvironment,
  type ResourceCatalog,
  parseResourceCatalog,
  resourceCatalogPath,
} from './catalog/resource-catalog.ts';
import { loadWorkflowPolicyInput } from './commands/policy-check.ts';
import { loadContractInput } from './commands/shared/contract-input.ts';
import type { Loaded } from './commands/shared/load-input.ts';
import { checkConfigContract } from './core/config-contract.ts';
import { LOCAL_STATE_DIR, planE2eStack } from './core/e2e-stack-plan.ts';
import { readExpectedToolVersions } from './core/tool-versions.ts';
import { checkWorkflowPolicy } from './core/workflow-policy.ts';
import {
  type HclBlock,
  type HclBody,
  attributeObjectOf,
  attributeTokensOf,
  blocksOf,
  parseHcl,
} from './test-fixtures/hcl-blocks.ts';
import { createFakeRepoFiles } from './test-fixtures/repo-files.ts';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

const readRepoText = (path: string): string =>
  readFileSync(resolve(REPO_ROOT, path), 'utf8');

const loadCatalog = (env: DeployEnvironment): ResourceCatalog => {
  const result = parseResourceCatalog(
    JSON.parse(readRepoText(resourceCatalogPath(env))),
    env,
  );
  if (!result.ok) {
    throw new Error(`${env}の資源一覧の誤り:\n${result.errors.join('\n')}`);
  }
  return result.catalog;
};

const projectIdOfRepo = (): string => {
  const result = checkSecretsSettings(readRepoText(INFISICAL_CONFIG_PATH));
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.settings.projectId;
};

interface DesignNames {
  readonly resourceSuffix: string;
  readonly hostSuffix: string;
  readonly branch: 'main' | 'prod';
}

// 設計のSupporting Referencesの「資源一覧の値」の表
const DESIGN_NAMES: Readonly<Record<DeployEnvironment, DesignNames>> = {
  staging: {
    resourceSuffix: '-staging',
    hostSuffix: '-staging',
    branch: 'main',
  },
  prod: { resourceSuffix: '-prod', hostSuffix: '', branch: 'prod' },
};

const ZONE_NAME = 'kurachiweb.com';

const PREFIX = 'genai-example-2';

const hostOf = (name: string, hostSuffix: string): string =>
  `${PREFIX}-${name}${hostSuffix}.lab.${ZONE_NAME}`;

describe.each(['staging', 'prod'] as const)('資源一覧(%s)', (env) => {
  const { resourceSuffix, hostSuffix, branch } = DESIGN_NAMES[env];
  const named = (name: string): { readonly name: string } => ({
    name: `${PREFIX}-${name}${resourceSuffix}`,
  });

  test('資源一覧のファイルを解析でき、環境の名前がファイル名と一致する', () => {
    const catalog = loadCatalog(env);

    expect(catalog.environment).toBe(env);
    expect(catalog.github).toEqual({ environment: env, branch });
  });

  test('ゾーン・管轄・資源の名前が設計の表と一致する', () => {
    const catalog = loadCatalog(env);

    expect(catalog.cloudflare.zoneName).toBe(ZONE_NAME);
    expect(catalog.jurisdiction).toBe('us');
    expect(catalog.d1).toEqual({
      main: { name: `${PREFIX}${resourceSuffix}` },
    });
    expect(catalog.r2).toEqual({
      images: named('images'),
      files: named('files'),
      quarantine: named('quarantine'),
    });
    expect(catalog.queues).toEqual({
      jobs: named('jobs'),
      'jobs-dlq': named('jobs-dlq'),
      'email-events': named('email-events'),
    });
    expect(catalog.workers).toEqual({
      api: { ...named('api'), appDir: 'apps/api' },
      event: { ...named('event'), appDir: 'apps/event' },
      client: { ...named('client'), appDir: 'apps/client' },
      admin: { ...named('admin'), appDir: 'apps/admin' },
    });
  });

  test('ホスト名と、それを使うbot判定・アクセス解析・送信ドメインが設計の表と一致する', () => {
    const catalog = loadCatalog(env);
    const client = hostOf('client', hostSuffix);
    const admin = hostOf('admin', hostSuffix);

    expect(catalog.hostnames).toEqual({
      api: { hostname: hostOf('api', hostSuffix), worker: 'api' },
      event: { hostname: hostOf('event', hostSuffix), worker: 'event' },
      client: { hostname: client, worker: 'client' },
      admin: { hostname: admin, worker: 'admin' },
      images: { hostname: hostOf('images', hostSuffix), worker: 'event' },
    });
    expect(catalog.turnstile).toEqual({
      name: `${PREFIX}${resourceSuffix}`,
      hostnames: [client, admin],
      mode: 'invisible',
    });
    expect(catalog.webAnalytics).toEqual({ hostname: client });
    expect(catalog.emailSending).toEqual({
      domain: hostOf('mail', hostSuffix),
      eventsQueue: 'email-events',
      events: [
        'message.bounced',
        'message.complained',
        'message.rejected',
        'message.failed',
      ],
      subscriptionName: `${PREFIX}-email-events${resourceSuffix}`,
    });
  });

  test('stateの保管先が設計の表と一致する', () => {
    expect(loadCatalog(env).state).toEqual({
      bucket: `${PREFIX}-tofu-state${resourceSuffix}`,
      key: 'live/terraform.tfstate',
    });
  });

  test('Infisicalは、検査と同じ接続先とaudienceで、リポジトリの設定ファイルと同じプロジェクトを使う', () => {
    const { infisical } = loadCatalog(env);

    expect(infisical.projectId).toBe(projectIdOfRepo());
    expect(infisical.host).toBe(CHECK_SECRETS_IDENTITY.host);
    expect(infisical.oidcAudience).toBe(CHECK_SECRETS_IDENTITY.oidcAudience);
  });
});

describe('検査用の主体の設定', () => {
  test('リポジトリのInfisicalの設定ファイルから、devの環境の設定を作れる', () => {
    const result = checkSecretsSettings(readRepoText(INFISICAL_CONFIG_PATH));

    expect(result.ok && result.settings.environment).toBe('dev');
  });
});

describe('ツールの版', () => {
  test('Dockerfile・ルートモジュールの版の指定・ルートのpackage.jsonから、技術スタックの表の版を読める', () => {
    const result = readExpectedToolVersions({
      dockerfile: readRepoText('Dockerfile'),
      liveVersionsTf: readRepoText('apps/infra/live/versions.tf'),
      rootPackageJson: readRepoText('package.json'),
    });

    expect(result).toEqual({
      ok: true,
      versions: {
        bun: '1.4.4',
        node: '26.12.1',
        opentofu: '1.13.2',
        infisicalCli: '0.44.8',
        wranglerTool: '4.152.0',
        mailpit: '1.32.0',
        playwright: '1.64.1',
      },
    });
  });
});

describe('検査のE2Eで起動するサービス', () => {
  const plan = planE2eStack({
    cliPath: 'cli.ts',
    mailpitBin: 'mailpit',
    logDir: 'logs',
  });

  const scriptsOf = (dir: string): Readonly<Record<string, string>> =>
    (
      JSON.parse(readRepoText(`${dir}/package.json`)) as {
        readonly scripts?: Readonly<Record<string, string>>;
      }
    ).scripts ?? {};

  test.each(['api', 'event'] as const)(
    '%sのwrangler devの引数は、devスクリプトの待ち受けのアドレスだけを127.0.0.1にしたものと一致する',
    (name) => {
      const service = plan.services.find(
        (candidate) => candidate.name === name,
      );
      const dir = service?.dir ?? '';
      const devScript = scriptsOf(dir).dev ?? '';
      const separator = service?.args.indexOf('--') ?? -1;
      const wranglerArgs = service?.args.slice(separator + 1) ?? [];

      expect(wranglerArgs.join(' ')).toBe(
        `bunx ${devScript.replace('--ip 0.0.0.0', '--ip 127.0.0.1')}`,
      );
    },
  );

  test('準備のスクリプトはapiに在り、wrangler devと同じローカル状態の保存先へマイグレーションを適用する', () => {
    const script = scriptsOf(plan.prepare.dir)['db:migrate:local'] ?? '';

    expect(plan.prepare.args).toEqual(['run', 'db:migrate:local']);
    expect(script).toContain('--local');
    expect(script).toContain(`--persist-to ${LOCAL_STATE_DIR}`);
  });
});

const repoFiles = createRepoFiles(REPO_ROOT);

const valueOrThrow = <T>(result: Loaded<T>): T => {
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.value;
};

describe('構成検査', () => {
  test.each(DEPLOY_ENVIRONMENTS)(
    '%sの資源一覧・4アプリのWrangler設定・backend設定に違反が無い',
    async (env) => {
      const input = valueOrThrow(await loadContractInput(repoFiles, env));

      expect(checkConfigContract(input)).toEqual([]);
    },
  );
});

describe('ワークフローの検査', () => {
  test('全ワークフロー・複合アクション・Dockerfileの版に違反が無い', async () => {
    const input = valueOrThrow(await loadWorkflowPolicyInput(repoFiles));

    expect(input.workflows.length).toBeGreaterThan(0);
    expect(checkWorkflowPolicy(input)).toEqual([]);
  });

  // ワークフローの検査は起動の入口・リリースの手順・承認者の定義の有無を見ないため、ファイルの存在をここで確かめる
  test.each([
    '.github/workflows/pull-request.yml',
    '.github/workflows/delivery.yml',
    '.github/workflows/release-pr.yml',
    '.github/workflows/checks.yml',
    '.github/workflows/deploy.yml',
    '.github/CODEOWNERS',
    '.github/actions/setup-toolchain/action.yml',
    '.github/trufflehog-exclude-paths.txt',
  ])('%sが在る', async (path) => {
    expect(await repoFiles.exists(path)).toBe(true);
  });
});

interface WorkflowJob {
  readonly 'timeout-minutes'?: unknown;
  readonly if?: unknown;
  readonly steps?: readonly { readonly env?: Record<string, unknown> }[];
}

const jobsOf = (path: string): Readonly<Record<string, WorkflowJob>> =>
  (Bun.YAML.parse(readRepoText(path)) as { jobs: Record<string, WorkflowJob> })
    .jobs;

describe('ワークフローのジョブの上限時間と起動条件', () => {
  // 再利用のワークフローを呼ぶジョブ(uses)は上限時間を持てないため、手順を持つジョブだけが対象
  test.each([
    [
      '.github/workflows/checks.yml',
      {
        'secret-scan': 15,
        quality: 30,
        tests: 30,
        e2e: 45,
        rehearsal: 30,
        'ci-gate': 5,
      },
    ],
    ['.github/workflows/deploy.yml', { deploy: 60 }],
    ['.github/workflows/release-pr.yml', { 'release-pr': 10 }],
  ])('%sの手順を持つ全ジョブに設計の上限時間がある', (path, expected) => {
    const jobs = jobsOf(path);

    expect(
      Object.fromEntries(
        Object.entries(jobs)
          .filter(([, job]) => job.steps !== undefined)
          .map(([name, job]) => [name, job['timeout-minutes']]),
      ),
    ).toEqual(expected);
  });

  test('リリースのPRの作成はmainから起動した時だけ動き、ghの操作先のリポジトリを環境変数で明示する', () => {
    const job = jobsOf('.github/workflows/release-pr.yml')['release-pr'];
    const runStep = job?.steps?.find(({ env }) => env?.RELEASE_HEAD);

    expect(job?.if).toBe("github.ref == 'refs/heads/main'");
    expect(runStep?.env).toEqual({
      GH_REPO: '${{ github.repository }}',
      GITHUB_TOKEN: '${{ github.token }}',
      RELEASE_HEAD: '${{ inputs.head }}',
    });
  });
});

const INFRA_TF_PATTERN = 'apps/infra/**/*.tf';

// tofu initが取得したモジュールの写し(.terraform)はリポジトリの定義ではないため読まない
const isInitCache = (path: string): boolean =>
  path.split('/').includes('.terraform');

const loadInfraHcl = async (
  files: RepoFiles = repoFiles,
): Promise<readonly HclBody[]> => {
  const paths = (await files.list(INFRA_TF_PATTERN)).filter(
    (path) => !isInitCache(path),
  );
  return Promise.all(
    paths.map(async (path) => {
      const text = await files.readText(path);
      try {
        return parseHcl(text);
      } catch (error) {
        throw new Error(`${path}を解析できません`, { cause: error });
      }
    }),
  );
};

const resourcesOf = (
  bodies: readonly HclBody[],
  type: string,
): readonly HclBlock[] =>
  bodies.flatMap((body) => blocksOf(body, 'resource', type));

const preventsDestroy = ({ body }: HclBlock): boolean =>
  blocksOf(body, 'lifecycle').some(
    (lifecycle) =>
      attributeTokensOf(lifecycle.body, 'prevent_destroy')?.join(' ') ===
      'true',
  );

const nameOf = ({ labels }: HclBlock): string => labels.join('.');

const TURNSTILE_REFERENCE =
  /\bcloudflare_turnstile_widget\s*\.\s*[A-Za-z_][\w-]*(?:\s*\[[^\]]*\])*(?:\s*\.\s*([A-Za-z_][\w-]*))?/g;

// 資源全体の参照はsecretの属性を含むため、secretの参照と同じく扱う
const referencesTurnstileSecret = (text: string): boolean =>
  [...text.matchAll(TURNSTILE_REFERENCE)].some(
    ([, attribute]) => attribute === undefined || attribute === 'secret',
  );

const expressionTextsOf = (body: HclBody): readonly string[] => [
  ...[...body.attributes.values()].map(({ tokens }) => tokens.join(' ')),
  ...body.blocks.flatMap((block) => expressionTextsOf(block.body)),
];

const addressOf = ({ type, labels }: HclBlock): string =>
  [type, ...labels].join('.');

// localsやmoduleの引数を経由して出力されるのを防ぐため、resourceブロックの外では参照そのものを禁じる
const turnstileSecretReferencesOf = (
  bodies: readonly HclBody[],
): readonly string[] =>
  bodies
    .flatMap(({ blocks }) => blocks)
    .filter(({ type }) => type !== 'resource')
    .filter(({ body }) =>
      expressionTextsOf(body).some(referencesTurnstileSecret),
    )
    .map(addressOf);

const d1Of = (name: string, guarded: boolean): string =>
  [
    `resource "cloudflare_d1_database" "${name}" {`,
    `  name = "${name}"`,
    ...(guarded ? ['  lifecycle {', '    prevent_destroy = true', '  }'] : []),
    '}',
    '',
  ].join('\n');

describe('IaC定義の読み取り', () => {
  test('apps/infra配下の深い場所の.tfも読み、プロバイダーとモジュールの取得先(.terraform)の中は読まない', async () => {
    const files = createFakeRepoFiles({
      'apps/infra/live/main.tf': d1Of('live', true),
      'apps/infra/modules/storage/nested/extra.tf': d1Of('deep', false),
      'apps/infra/.terraform/modules/remote/main.tf': d1Of('cached', false),
      'apps/infra/live/.terraform/modules/remote/main.tf': d1Of(
        'live_cached',
        false,
      ),
    });

    const resources = resourcesOf(
      await loadInfraHcl(files),
      'cloudflare_d1_database',
    );

    expect(resources.map(nameOf).toSorted()).toEqual([
      'cloudflare_d1_database.deep',
      'cloudflare_d1_database.live',
    ]);
  });

  test('bot判定の資源のsecretへの参照と資源全体の参照を、resourceブロックの外(locals・output・module引数・補間)から見つける', () => {
    const body = parseHcl(
      [
        'locals {',
        '  widget_secret = cloudflare_turnstile_widget.this.secret',
        '}',
        'output "via_local" {',
        '  value = local.widget_secret',
        '}',
        'module "worker" {',
        '  source = "./worker"',
        '  secret = cloudflare_turnstile_widget.this.secret',
        '}',
        'output "interpolated" {',
        '  value = "key=${cloudflare_turnstile_widget.indexed[0].secret}"',
        '}',
        'output "whole" {',
        '  value = cloudflare_turnstile_widget.this',
        '}',
        'output "sitekey" {',
        '  value = cloudflare_turnstile_widget.this.sitekey',
        '}',
        'output "other_secret" {',
        '  value = var.secret_name',
        '}',
        'resource "cloudflare_workers_secret" "turnstile" {',
        '  text = cloudflare_turnstile_widget.this.secret',
        '}',
      ].join('\n'),
    );

    expect(turnstileSecretReferencesOf([body])).toEqual([
      'locals',
      'module.worker',
      'output.interpolated',
      'output.whole',
    ]);
  });
});

describe('IaC定義', () => {
  test.each([
    'cloudflare_d1_database',
    'cloudflare_r2_bucket',
    'cloudflare_turnstile_widget',
  ])('%sの全資源に削除の防止がある', async (type) => {
    const resources = resourcesOf(await loadInfraHcl(), type);

    expect(resources.length).toBeGreaterThan(0);
    expect(
      resources.filter((resource) => !preventsDestroy(resource)).map(nameOf),
    ).toEqual([]);
  });

  test('D1の全資源で読み取りレプリカを無効と明示する', async () => {
    const resources = resourcesOf(
      await loadInfraHcl(),
      'cloudflare_d1_database',
    );

    expect(resources.length).toBeGreaterThan(0);
    expect(
      resources.map(({ body }) =>
        attributeTokensOf(
          attributeObjectOf(body, 'read_replication'),
          'mode',
        )?.join(' '),
      ),
    ).toEqual(resources.map(() => '"disabled"'));
  });

  test('R2は所在地のヒントを指定せず、管轄だけで保存場所を決める', async () => {
    const resources = resourcesOf(await loadInfraHcl(), 'cloudflare_r2_bucket');

    expect(
      resources
        .filter(({ body }) => body.attributes.has('location'))
        .map(nameOf),
    ).toEqual([]);
  });

  test('Queueはデータを保持する資源ではないため削除の防止を付けない', async () => {
    const resources = resourcesOf(await loadInfraHcl(), 'cloudflare_queue');

    expect(resources.length).toBeGreaterThan(0);
    expect(resources.filter(preventsDestroy).map(nameOf)).toEqual([]);
  });

  test('Workerのホスト名の割り当てに非推奨のenvironmentを使わない', async () => {
    const resources = resourcesOf(
      await loadInfraHcl(),
      'cloudflare_workers_custom_domain',
    );

    expect(resources.length).toBeGreaterThan(0);
    expect(
      resources
        .filter(({ body }) => body.attributes.has('environment'))
        .map(nameOf),
    ).toEqual([]);
  });

  test('resourceブロックの外ではbot判定の秘密鍵(secret)とその資源全体を参照しない', async () => {
    expect(turnstileSecretReferencesOf(await loadInfraHcl())).toEqual([]);
  });

  test('出力はbot判定の秘密鍵(secret)を参照しない', async () => {
    const outputs = (await loadInfraHcl()).flatMap((body) =>
      blocksOf(body, 'output'),
    );

    expect(outputs.length).toBeGreaterThan(0);
    expect(
      outputs
        .filter(({ body }) =>
          attributeTokensOf(body, 'value')?.includes('secret'),
        )
        .map(nameOf),
    ).toEqual([]);
  });
});
