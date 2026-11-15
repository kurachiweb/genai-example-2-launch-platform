import { describe, expect, test } from 'bun:test';

import {
  type ResourceCatalog,
  WORKER_KEYS,
  type WorkerKey,
  parseResourceCatalog,
} from '../catalog/resource-catalog.ts';
import {
  PLACEHOLDER_CLOUDFLARE_ID,
  PLACEHOLDER_UUID,
  validCatalogJson,
} from '../test-fixtures/resource-catalog.ts';
import {
  BACKEND_FILE,
  STAGING_D1_DATABASE_ID,
  backendHclOf,
  wranglerFileOf,
  wranglerJsoncOf,
} from '../test-fixtures/wrangler-config.ts';
import { type ContractInput, checkConfigContract } from './config-contract.ts';
import type { ContractViolation } from './violation.ts';
import {
  type EffectiveWranglerConfig,
  readEffectiveConfig,
} from './wrangler-config.ts';

const CATALOG_FILE = 'apps/infra/environments/staging.json';

const ACCOUNT_ID = '0123456789abcdef0123456789abcdef';

const catalogOf = (json: Record<string, unknown>): ResourceCatalog => {
  const result = parseResourceCatalog(json, 'staging');
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.catalog;
};

const effectiveConfigOf = (worker: WorkerKey): EffectiveWranglerConfig => {
  const result = readEffectiveConfig(wranglerJsoncOf(worker), 'staging');
  if (!result.ok) throw new Error(result.error);
  return result.config;
};

const validInput = (): ContractInput => ({
  catalog: catalogOf(validCatalogJson()),
  workers: Object.fromEntries(
    WORKER_KEYS.map((worker) => [
      worker,
      { file: wranglerFileOf(worker), config: effectiveConfigOf(worker) },
    ]),
  ) as ContractInput['workers'],
  backendFile: { file: BACKEND_FILE, text: backendHclOf(ACCOUNT_ID) },
});

const withWorker = (
  input: ContractInput,
  worker: WorkerKey,
  patch: Partial<EffectiveWranglerConfig>,
): ContractInput => ({
  ...input,
  workers: {
    ...input.workers,
    [worker]: {
      ...input.workers[worker],
      config: { ...input.workers[worker].config, ...patch },
    },
  },
});

const withCatalog = (patch: Record<string, unknown>): ContractInput => ({
  ...validInput(),
  catalog: catalogOf({ ...validCatalogJson(), ...patch }),
});

const withBackend = (text: string): ContractInput => ({
  ...validInput(),
  backendFile: { file: BACKEND_FILE, text },
});

const violation = (
  rule: string,
  file: string,
  path: string,
  actual: string,
  expected: string,
): ContractViolation => ({ rule, file, path, actual, expected });

const API_FILE = wranglerFileOf('api');
const EVENT_FILE = wranglerFileOf('event');
const CLIENT_FILE = wranglerFileOf('client');

const D1_NAMES = 'app-stagingのいずれか';
const R2_NAMES =
  'app-images-staging・app-files-staging・app-quarantine-stagingのいずれか';
const QUEUE_NAMES =
  'app-jobs-staging・app-jobs-dlq-staging・app-email-events-stagingのいずれか';
const WORKER_NAMES =
  'app-api-staging・app-event-staging・app-client-staging・app-admin-stagingのいずれか';

describe('checkConfigContract', () => {
  test('資源一覧とWrangler設定・backend設定が一致すれば違反を返さない', () => {
    expect(checkConfigContract(validInput())).toEqual([]);
  });

  test('C1: 資源一覧に無いD1・R2・Queueの名前を違反として返す', () => {
    const base = validInput();
    const api = base.workers.api.config;
    const input = withWorker(base, 'api', {
      d1: [
        ...api.d1,
        {
          binding: 'AUDIT_DB',
          databaseName: 'app-audit-staging',
          databaseId: STAGING_D1_DATABASE_ID,
        },
      ],
      r2: [
        ...api.r2,
        { binding: 'LOGS_BUCKET', bucketName: 'app-logs', jurisdiction: 'us' },
      ],
      queueNames: [...api.queueNames, 'app-unknown-staging'],
    });

    expect(checkConfigContract(input)).toEqual([
      violation(
        'C1',
        API_FILE,
        'env.staging.d1_databases[AUDIT_DB].database_name',
        'app-audit-staging',
        D1_NAMES,
      ),
      violation(
        'C1',
        API_FILE,
        'env.staging.r2_buckets[LOGS_BUCKET].bucket_name',
        'app-logs',
        R2_NAMES,
      ),
      violation(
        'C1',
        API_FILE,
        'env.staging.queues',
        'app-unknown-staging',
        QUEUE_NAMES,
      ),
    ]);
  });

  test('C2: どのWorkerからも参照されない資源一覧のD1・R2・Queueを違反として返す', () => {
    const json = validCatalogJson();
    const input = withCatalog({
      d1: { ...(json['d1'] as object), audit: { name: 'app-audit-staging' } },
      r2: { ...(json['r2'] as object), logs: { name: 'app-logs-staging' } },
      queues: {
        ...(json['queues'] as object),
        reports: { name: 'app-reports-staging' },
      },
    });

    expect(checkConfigContract(input)).toEqual([
      violation(
        'C2',
        CATALOG_FILE,
        'd1.audit.name',
        '参照なし',
        'いずれかのWorkerからapp-audit-stagingへの参照',
      ),
      violation(
        'C2',
        CATALOG_FILE,
        'r2.logs.name',
        '参照なし',
        'いずれかのWorkerからapp-logs-stagingへの参照',
      ),
      violation(
        'C2',
        CATALOG_FILE,
        'queues.reports.name',
        '参照なし',
        'いずれかのWorkerからapp-reports-stagingへの参照',
      ),
    ]);
  });

  test('C3: 管轄の欠落と資源一覧と異なる管轄を違反として返す', () => {
    const base = validInput();
    const [images, files, quarantine] = base.workers.event.config.r2;
    if (!images || !files || !quarantine) throw new Error('R2の例が不足');
    const input = withWorker(base, 'event', {
      r2: [
        { ...images, jurisdiction: undefined },
        { ...files, jurisdiction: 'eu' },
        quarantine,
      ],
    });

    expect(checkConfigContract(input)).toEqual([
      violation(
        'C3',
        EVENT_FILE,
        'env.staging.r2_buckets[IMAGES_BUCKET].jurisdiction',
        '',
        'us',
      ),
      violation(
        'C3',
        EVENT_FILE,
        'env.staging.r2_buckets[FILES_BUCKET].jurisdiction',
        'eu',
        'us',
      ),
    ]);
  });

  test('C4: 資源一覧と異なるWorker名と、資源一覧に無いService Bindingsの接続先を違反として返す', () => {
    const base = validInput();
    const input = withWorker(
      withWorker(base, 'admin', { workerName: 'app-admin' }),
      'client',
      { services: ['app-api-staging', 'app-api'] },
    );

    expect(checkConfigContract(input)).toEqual([
      violation(
        'C4',
        CLIENT_FILE,
        'env.staging.services[1].service',
        'app-api',
        WORKER_NAMES,
      ),
      violation(
        'C4',
        wranglerFileOf('admin'),
        'name',
        'app-admin',
        'app-admin-staging',
      ),
    ]);
  });

  test('C5: 実効の公開サブドメイン・プレビューURLが無効でなく、ルートがあれば違反として返す', () => {
    const base = validInput();
    const input = withWorker(
      withWorker(base, 'client', {
        workersDev: undefined,
        previewUrls: true,
        hasRoutes: true,
      }),
      'api',
      { workersDev: true },
    );

    expect(checkConfigContract(input)).toEqual([
      violation('C5', API_FILE, 'workers_dev', 'true', 'false'),
      violation('C5', CLIENT_FILE, 'workers_dev', '', 'false'),
      violation('C5', CLIENT_FILE, 'preview_urls', 'true', 'false'),
      violation('C5', CLIENT_FILE, 'route・routes', 'あり', 'なし'),
    ]);
  });

  test('C4・C5: 継承するキーの違反を値の出どころの項目で返す', () => {
    const input = withWorker(validInput(), 'admin', {
      workerName: 'app-admin',
      workersDev: true,
      previewUrls: true,
      hasRoutes: true,
      sourcePaths: {
        name: 'env.staging.name',
        workersDev: 'env.staging.workers_dev',
        previewUrls: 'env.staging.preview_urls',
        routes: 'env.staging.routes',
      },
    });
    const adminFile = wranglerFileOf('admin');

    expect(checkConfigContract(input)).toEqual([
      violation(
        'C4',
        adminFile,
        'env.staging.name',
        'app-admin',
        'app-admin-staging',
      ),
      violation('C5', adminFile, 'env.staging.workers_dev', 'true', 'false'),
      violation('C5', adminFile, 'env.staging.preview_urls', 'true', 'false'),
      violation('C5', adminFile, 'env.staging.routes', 'あり', 'なし'),
    ]);
  });

  test('C6: apiとeventで同じD1の識別子が異なれば違反として返す', () => {
    const base = validInput();
    const [main] = base.workers.event.config.d1;
    if (!main) throw new Error('D1の例が不足');
    const otherId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const input = withWorker(base, 'event', {
      d1: [{ ...main, databaseId: otherId }],
    });

    expect(checkConfigContract(input)).toEqual([
      violation(
        'C6',
        EVENT_FILE,
        'env.staging.d1_databases[DB].database_id',
        otherId,
        STAGING_D1_DATABASE_ID,
      ),
    ]);
  });

  test('C6: apiかeventのD1の識別子が仮の値なら違反にしない', () => {
    const base = validInput();
    const [main] = base.workers.event.config.d1;
    if (!main) throw new Error('D1の例が不足');
    const placeholderD1 = [{ ...main, databaseId: PLACEHOLDER_UUID }];

    const eventOnly = withWorker(base, 'event', { d1: placeholderD1 });
    const apiOnly = withWorker(base, 'api', { d1: placeholderD1 });
    const both = withWorker(eventOnly, 'api', { d1: placeholderD1 });

    expect(checkConfigContract(eventOnly)).toEqual([]);
    expect(checkConfigContract(apiOnly)).toEqual([]);
    expect(checkConfigContract(both)).toEqual([]);
  });

  test('C7: backend設定のバケット・キー・接続先の食い違いを違反として返す', () => {
    const input = withBackend(`bucket = "app-tofu-state-prod"
key    = "state/terraform.tfstate"
endpoints = { s3 = "https://fedcba9876543210fedcba9876543210.r2.cloudflarestorage.com" }
`);

    expect(checkConfigContract(input)).toEqual([
      violation(
        'C7',
        BACKEND_FILE,
        'bucket',
        'app-tofu-state-prod',
        'app-tofu-state-staging',
      ),
      violation(
        'C7',
        BACKEND_FILE,
        'key',
        'state/terraform.tfstate',
        'live/terraform.tfstate',
      ),
      violation(
        'C7',
        BACKEND_FILE,
        'endpoints.s3',
        'https://fedcba9876543210fedcba9876543210.r2.cloudflarestorage.com',
        `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
      ),
    ]);
  });

  test('C7: backend設定に無い項目とコメントにだけある項目を違反として返す', () => {
    const input = withBackend('# bucket = "app-tofu-state-staging"\n');

    expect(checkConfigContract(input)).toEqual([
      violation('C7', BACKEND_FILE, 'bucket', '', 'app-tofu-state-staging'),
      violation('C7', BACKEND_FILE, 'key', '', 'live/terraform.tfstate'),
      violation(
        'C7',
        BACKEND_FILE,
        'endpoints.s3',
        '',
        `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
      ),
    ]);
  });

  test('C7: 資源一覧のアカウントの識別子が仮の値なら接続先を違反にしない', () => {
    const placeholderCatalog = withCatalog({
      cloudflare: {
        ...(validCatalogJson()['cloudflare'] as object),
        accountId: PLACEHOLDER_CLOUDFLARE_ID,
      },
    });
    const bothPlaceholders = {
      ...placeholderCatalog,
      backendFile: {
        file: BACKEND_FILE,
        text: backendHclOf(PLACEHOLDER_CLOUDFLARE_ID),
      },
    };

    expect(checkConfigContract(placeholderCatalog)).toEqual([]);
    expect(checkConfigContract(bothPlaceholders)).toEqual([]);
  });

  test('C7: 資源一覧のアカウントの識別子が仮の値でも、R2の形でない接続先は違反として返す', () => {
    const input = {
      ...withCatalog({
        cloudflare: {
          ...(validCatalogJson()['cloudflare'] as object),
          accountId: PLACEHOLDER_CLOUDFLARE_ID,
        },
      }),
      backendFile: {
        file: BACKEND_FILE,
        text: 'bucket = "app-tofu-state-staging"\nkey = "live/terraform.tfstate"\nendpoints = { s3 = "https://storage.example" }\n',
      },
    };

    expect(checkConfigContract(input)).toEqual([
      violation(
        'C7',
        BACKEND_FILE,
        'endpoints.s3',
        'https://storage.example',
        `https://${PLACEHOLDER_CLOUDFLARE_ID}.r2.cloudflarestorage.com`,
      ),
    ]);
  });

  test('C7: 本物のアカウントの識別子に対して仮の値の接続先を違反として返す', () => {
    const input = withBackend(backendHclOf(PLACEHOLDER_CLOUDFLARE_ID));

    expect(checkConfigContract(input)).toEqual([
      violation(
        'C7',
        BACKEND_FILE,
        'endpoints.s3',
        `https://${PLACEHOLDER_CLOUDFLARE_ID}.r2.cloudflarestorage.com`,
        'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com',
      ),
    ]);
  });

  test('C8: 配信不能イベントの受け皿のQueueがeventの受信元に無ければ違反として返す', () => {
    const base = validInput();
    const input = withWorker(base, 'event', {
      queueConsumers: ['app-jobs-staging', 'app-jobs-dlq-staging'],
    });

    expect(checkConfigContract(input)).toEqual([
      violation(
        'C8',
        EVENT_FILE,
        'env.staging.queues.consumers',
        'app-jobs-staging・app-jobs-dlq-staging',
        'app-email-events-staging',
      ),
    ]);
  });

  test('C8: 受け皿のQueueをevent以外のWorkerだけが受信していても違反として返す', () => {
    const base = validInput();
    const moved = withWorker(
      withWorker(base, 'event', { queueConsumers: [] }),
      'api',
      { queueConsumers: ['app-email-events-staging'] },
    );

    expect(checkConfigContract(moved)).toEqual([
      violation(
        'C8',
        EVENT_FILE,
        'env.staging.queues.consumers',
        '',
        'app-email-events-staging',
      ),
    ]);
  });
});
