import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  CHECK_SECRETS_IDENTITY,
  INFISICAL_CONFIG_PATH,
  checkSecretsSettings,
} from './catalog/check-secrets.ts';
import {
  type DeployEnvironment,
  type ResourceCatalog,
  parseResourceCatalog,
  resourceCatalogPath,
} from './catalog/resource-catalog.ts';
import { LOCAL_STATE_DIR, planE2eStack } from './core/e2e-stack-plan.ts';
import { readExpectedToolVersions } from './core/tool-versions.ts';

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
