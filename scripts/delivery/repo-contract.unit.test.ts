import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createRepoFiles } from './adapters/repo-files.ts';
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

const INFRA_TF_PATTERNS = [
  'apps/infra/live/*.tf',
  'apps/infra/modules/*/*.tf',
] as const;

const loadInfraHcl = async (): Promise<readonly HclBody[]> => {
  const paths = (
    await Promise.all(
      INFRA_TF_PATTERNS.map((pattern) => repoFiles.list(pattern)),
    )
  ).flat();
  return Promise.all(
    paths.map(async (path) => {
      const text = await repoFiles.readText(path);
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
