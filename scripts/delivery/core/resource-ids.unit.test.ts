import { describe, expect, test } from 'bun:test';

import {
  type DeployEnvironment,
  WORKER_KEYS,
  type WorkerKey,
} from '../catalog/resource-catalog.ts';
import { PLACEHOLDER_UUID } from '../test-fixtures/resource-catalog.ts';
import type { WorkerConfigFile } from './config-contract.ts';
import {
  RESOURCE_ID_TARGETS,
  type ResourceIdMismatch,
  formatMismatchMarkdown,
  formatMismatchTable,
  reconcileResourceIds,
} from './resource-ids.ts';
import type { EffectiveWranglerConfig } from './wrangler-config.ts';

const D1_ID = '3f9c2b1a-6d4e-4f8a-9b7c-1e2d3c4b5a69';
const SITEKEY = '0x4AAAAAAAB1c2D3e4F5g6H7';
const ANALYTICS_TOKEN = 'fake-web-analytics-site-token';
const SENSITIVE_VALUE = 'fake-sensitive-output-value';

const PLACEHOLDER_SITEKEY = '0x0000000000000000000000';
const PLACEHOLDER_ANALYTICS_TOKEN = '00000000000000000000000000000000';

interface ResourceIds {
  readonly d1?: unknown;
  readonly turnstile_sitekey?: unknown;
  readonly web_analytics_site_token?: unknown;
}

const REAL_IDS: ResourceIds = {
  d1: { main: D1_ID },
  turnstile_sitekey: SITEKEY,
  web_analytics_site_token: ANALYTICS_TOKEN,
};

const outputsJsonOf = (
  resourceIds: ResourceIds = REAL_IDS,
  extra: Record<string, unknown> = {},
): string =>
  JSON.stringify({
    ...extra,
    resource_ids: {
      sensitive: false,
      type: ['object', {}],
      value: resourceIds,
    },
  });

interface ConfigValues {
  readonly d1Id?: string;
  readonly sitekey?: string;
  readonly analyticsToken?: string;
}

const configOf = (
  worker: WorkerKey,
  vars: Readonly<Record<string, string>>,
  d1: EffectiveWranglerConfig['d1'],
): EffectiveWranglerConfig => ({
  workerName: `app-${worker}-staging`,
  workersDev: false,
  previewUrls: false,
  hasRoutes: false,
  d1,
  r2: [],
  queueNames: [],
  queueConsumers: [],
  services: [],
  vars,
  requiredSecrets: [],
  sourcePaths: {
    name: 'name',
    workersDev: 'workers_dev',
    previewUrls: 'preview_urls',
    routes: 'route・routes',
  },
});

const fileOf = (worker: WorkerKey): string => `apps/${worker}/wrangler.jsonc`;

const configsOf = ({
  d1Id = D1_ID,
  sitekey = SITEKEY,
  analyticsToken = ANALYTICS_TOKEN,
}: ConfigValues = {}): Record<WorkerKey, WorkerConfigFile> => {
  const d1 = [{ binding: 'DB', databaseName: 'app-staging', databaseId: d1Id }];
  const configs: Record<WorkerKey, EffectiveWranglerConfig> = {
    api: configOf('api', { LOG_LEVEL: 'info' }, d1),
    event: configOf('event', { LOG_LEVEL: 'info' }, d1),
    client: configOf(
      'client',
      { TURNSTILE_SITE_KEY: sitekey, WEB_ANALYTICS_TOKEN: analyticsToken },
      [],
    ),
    admin: configOf('admin', { TURNSTILE_SITE_KEY: sitekey }, []),
  };
  return Object.fromEntries(
    WORKER_KEYS.map((worker) => [
      worker,
      { file: fileOf(worker), config: configs[worker] },
    ]),
  ) as Record<WorkerKey, WorkerConfigFile>;
};

const reconcile = (
  outputsJson: string,
  configs: Record<WorkerKey, WorkerConfigFile> = configsOf(),
  environment: DeployEnvironment = 'staging',
) => reconcileResourceIds(outputsJson, configs, environment);

const mismatchesOf = (
  result: ReturnType<typeof reconcileResourceIds>,
): readonly ResourceIdMismatch[] => {
  if ('error' in result) throw new Error(result.error);
  return result;
};

const errorOf = (result: ReturnType<typeof reconcileResourceIds>): string => {
  if (!('error' in result)) throw new Error('誤りになるはずが照合できました');
  return result.error;
};

describe('RESOURCE_ID_TARGETS', () => {
  test('D1はapiとevent、Turnstileのサイトキーはclientとadmin、アクセス解析のトークンはclientへ写す', () => {
    expect(
      RESOURCE_ID_TARGETS.map(({ output, worker }) => [
        output.join('.'),
        worker,
      ]),
    ).toEqual([
      ['d1.main', 'api'],
      ['d1.main', 'event'],
      ['turnstile_sitekey', 'client'],
      ['turnstile_sitekey', 'admin'],
      ['web_analytics_site_token', 'client'],
    ]);
  });
});

describe('reconcileResourceIds', () => {
  test('全ての識別子が出力と一致すれば食い違いは無い', () => {
    expect(mismatchesOf(reconcile(outputsJsonOf()))).toEqual([]);
  });

  test('Wrangler設定が仮の値のままなら、全ての項目を反映すべき値と共に返す', () => {
    const result = reconcile(
      outputsJsonOf(),
      configsOf({
        d1Id: PLACEHOLDER_UUID,
        sitekey: PLACEHOLDER_SITEKEY,
        analyticsToken: PLACEHOLDER_ANALYTICS_TOKEN,
      }),
    );

    expect(mismatchesOf(result)).toEqual([
      {
        worker: 'api',
        file: 'apps/api/wrangler.jsonc',
        configPath: 'env.staging.d1_databases[DB].database_id',
        current: PLACEHOLDER_UUID,
        expected: D1_ID,
      },
      {
        worker: 'event',
        file: 'apps/event/wrangler.jsonc',
        configPath: 'env.staging.d1_databases[DB].database_id',
        current: PLACEHOLDER_UUID,
        expected: D1_ID,
      },
      {
        worker: 'client',
        file: 'apps/client/wrangler.jsonc',
        configPath: 'env.staging.vars.TURNSTILE_SITE_KEY',
        current: PLACEHOLDER_SITEKEY,
        expected: SITEKEY,
      },
      {
        worker: 'admin',
        file: 'apps/admin/wrangler.jsonc',
        configPath: 'env.staging.vars.TURNSTILE_SITE_KEY',
        current: PLACEHOLDER_SITEKEY,
        expected: SITEKEY,
      },
      {
        worker: 'client',
        file: 'apps/client/wrangler.jsonc',
        configPath: 'env.staging.vars.WEB_ANALYTICS_TOKEN',
        current: PLACEHOLDER_ANALYTICS_TOKEN,
        expected: ANALYTICS_TOKEN,
      },
    ]);
  });

  test('一部のWorkerだけが食い違えば、その項目だけを返す', () => {
    const configs = configsOf();
    const event = configs.event;
    const result = reconcile(outputsJsonOf(), {
      ...configs,
      event: {
        ...event,
        config: {
          ...event.config,
          d1: [
            {
              binding: 'DB',
              databaseName: 'app-staging',
              databaseId: '11111111-2222-4333-8444-555555555555',
            },
          ],
        },
      },
    });

    expect(mismatchesOf(result)).toEqual([
      {
        worker: 'event',
        file: 'apps/event/wrangler.jsonc',
        configPath: 'env.staging.d1_databases[DB].database_id',
        current: '11111111-2222-4333-8444-555555555555',
        expected: D1_ID,
      },
    ]);
  });

  test('D1のバインディングや変数がWrangler設定に無ければ、現在の値を空として返す', () => {
    const configs = configsOf();
    const result = reconcile(outputsJsonOf(), {
      ...configs,
      api: { ...configs.api, config: { ...configs.api.config, d1: [] } },
      admin: {
        ...configs.admin,
        config: { ...configs.admin.config, vars: {} },
      },
    });

    expect(
      mismatchesOf(result).map(({ worker, configPath, current }) => [
        worker,
        configPath,
        current,
      ]),
    ).toEqual([
      ['api', 'env.staging.d1_databases[DB].database_id', ''],
      ['admin', 'env.staging.vars.TURNSTILE_SITE_KEY', ''],
    ]);
  });

  test('prodでは項目のパスにprodの節を示す', () => {
    const result = reconcile(
      outputsJsonOf(),
      configsOf({ sitekey: PLACEHOLDER_SITEKEY }),
      'prod',
    );

    expect(mismatchesOf(result).map(({ configPath }) => configPath)).toEqual([
      'env.prod.vars.TURNSTILE_SITE_KEY',
      'env.prod.vars.TURNSTILE_SITE_KEY',
    ]);
  });

  test('sensitiveな出力は値を読まずに飛ばし、結果に値が現れない', () => {
    const result = reconcile(
      outputsJsonOf(REAL_IDS, {
        hidden: { sensitive: true, type: 'string', value: SENSITIVE_VALUE },
        broken: { sensitive: true, type: 'object', value: { d1: 42 } },
      }),
      configsOf({ d1Id: PLACEHOLDER_UUID }),
    );

    expect(mismatchesOf(result)).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain(SENSITIVE_VALUE);
  });

  test('resource_idsがsensitiveなら、値を示さずに誤りを返す', () => {
    const error = errorOf(
      reconcile(
        JSON.stringify({
          resource_ids: {
            sensitive: true,
            type: 'string',
            value: { d1: { main: SENSITIVE_VALUE } },
          },
        }),
      ),
    );

    expect(error).toBe(
      'OpenTofuの出力resource_idsがsensitiveのため読み取りません。outputs.tfで秘密でない識別子だけを出力してください',
    );
    expect(error).not.toContain(SENSITIVE_VALUE);
  });

  test('resource_idsが無ければ誤りを返す', () => {
    expect(errorOf(reconcile(JSON.stringify({})))).toBe(
      'OpenTofuの出力にresource_idsがありません',
    );
  });

  test('JSONとして解析できなければ、入力を示さずに誤りを返す', () => {
    const error = errorOf(reconcile(`{"hidden": "${SENSITIVE_VALUE}"`));

    expect(error).toBe('OpenTofuの出力をJSONとして解析できません');
  });

  test.each([
    [
      '出力がオブジェクトでない',
      '[]',
      'OpenTofuの出力がオブジェクトではありません',
    ],
    [
      'resource_idsがオブジェクトでない',
      JSON.stringify({ resource_ids: 'x' }),
      'OpenTofuの出力resource_idsの形が不正です',
    ],
    [
      'resource_idsの値がオブジェクトでない',
      JSON.stringify({ resource_ids: { sensitive: false, value: 'x' } }),
      'OpenTofuの出力resource_ids.d1.mainが文字列ではありません',
    ],
    [
      'D1の識別子が無い',
      outputsJsonOf({ ...REAL_IDS, d1: {} }),
      'OpenTofuの出力resource_ids.d1.mainが文字列ではありません',
    ],
    [
      'サイトキーが文字列でない',
      outputsJsonOf({ ...REAL_IDS, turnstile_sitekey: 1 }),
      'OpenTofuの出力resource_ids.turnstile_sitekeyが文字列ではありません',
    ],
    [
      'トークンが空',
      outputsJsonOf({ ...REAL_IDS, web_analytics_site_token: '' }),
      'OpenTofuの出力resource_ids.web_analytics_site_tokenが空です',
    ],
  ])('%sなら誤りを返す', (_, outputsJson, expected) => {
    expect(errorOf(reconcile(outputsJson))).toBe(expected);
  });
});

const MISMATCHES: readonly ResourceIdMismatch[] = [
  {
    worker: 'api',
    file: 'apps/api/wrangler.jsonc',
    configPath: 'env.staging.d1_databases[DB].database_id',
    current: PLACEHOLDER_UUID,
    expected: D1_ID,
  },
  {
    worker: 'admin',
    file: 'apps/admin/wrangler.jsonc',
    configPath: 'env.staging.vars.TURNSTILE_SITE_KEY',
    current: '',
    expected: SITEKEY,
  },
];

describe('formatMismatchTable', () => {
  test('ファイル・項目・現在の値・反映すべき値の表を揃えて返す', () => {
    expect(formatMismatchTable(MISMATCHES)).toBe(
      [
        '識別子の食い違いが2件あります。反映すべき値をWrangler設定へ書いてください。',
        'ファイル                   項目                                      現在の値                              反映すべき値',
        `apps/api/wrangler.jsonc    env.staging.d1_databases[DB].database_id  ${PLACEHOLDER_UUID}  ${D1_ID}`,
        `apps/admin/wrangler.jsonc  env.staging.vars.TURNSTILE_SITE_KEY       (なし)                                ${SITEKEY}`,
        '',
      ].join('\n'),
    );
  });

  test('食い違いが無ければその旨だけを返す', () => {
    expect(formatMismatchTable([])).toBe('識別子の食い違いはありません。\n');
  });
});

describe('formatMismatchMarkdown', () => {
  test('見出しと表をMarkdownで返す', () => {
    expect(formatMismatchMarkdown('資源の識別子の照合', MISMATCHES)).toBe(
      [
        '### 資源の識別子の照合',
        '',
        '識別子の食い違いが2件あります。反映すべき値をWrangler設定へ書いてください。',
        '',
        '| ファイル | 項目 | 現在の値 | 反映すべき値 |',
        '| --- | --- | --- | --- |',
        `| apps/api/wrangler.jsonc | env.staging.d1_databases[DB].database_id | ${PLACEHOLDER_UUID} | ${D1_ID} |`,
        `| apps/admin/wrangler.jsonc | env.staging.vars.TURNSTILE_SITE_KEY | (なし) | ${SITEKEY} |`,
        '',
      ].join('\n'),
    );
  });

  test('食い違いが無ければその旨だけを返す', () => {
    expect(formatMismatchMarkdown('資源の識別子の照合', [])).toBe(
      '### 資源の識別子の照合\n\n識別子の食い違いはありません。\n',
    );
  });
});
