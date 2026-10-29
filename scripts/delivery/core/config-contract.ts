import {
  type ResourceCatalog,
  WORKER_KEYS,
  type WorkerKey,
  isPlaceholderId,
  resourceCatalogPath,
} from '../catalog/resource-catalog.ts';
import type { ContractViolation } from './violation.ts';
import type { EffectiveWranglerConfig } from './wrangler-config.ts';

export interface WorkerConfigFile {
  readonly file: string;
  readonly config: EffectiveWranglerConfig;
}

export interface ContractInput {
  readonly catalog: ResourceCatalog;
  readonly workers: Readonly<Record<WorkerKey, WorkerConfigFile>>;
  readonly backendFile: { readonly file: string; readonly text: string };
}

type Rule = (input: ContractInput) => readonly ContractViolation[];

type CatalogResourceKind = 'd1' | 'r2' | 'queues';

const CATALOG_RESOURCE_KINDS: readonly CatalogResourceKind[] = [
  'd1',
  'r2',
  'queues',
];

const R2_ENDPOINT_PATTERN =
  /^https:\/\/[\da-f]{32}\.r2\.cloudflarestorage\.com$/;

const violation = (
  rule: string,
  file: string,
  path: string,
  actual: string,
  expected: string,
): ContractViolation => ({ rule, file, path, actual, expected });

const workerFilesOf = (input: ContractInput): readonly WorkerConfigFile[] =>
  WORKER_KEYS.map((key) => input.workers[key]);

const sectionOf = (input: ContractInput): string =>
  `env.${input.catalog.environment}`;

const catalogNamesOf = (
  catalog: ResourceCatalog,
  kind: CatalogResourceKind,
): readonly string[] => Object.values(catalog[kind]).map(({ name }) => name);

const oneOf = (names: readonly string[]): string =>
  `${names.join('・')}のいずれか`;

interface ResourceReference {
  readonly kind: CatalogResourceKind;
  readonly path: string;
  readonly name: string;
}

const referencesOf = (
  config: EffectiveWranglerConfig,
  section: string,
): readonly ResourceReference[] => [
  ...config.d1.map(({ binding, databaseName }) => ({
    kind: 'd1' as const,
    path: `${section}.d1_databases[${binding}].database_name`,
    name: databaseName,
  })),
  ...config.r2.map(({ binding, bucketName }) => ({
    kind: 'r2' as const,
    path: `${section}.r2_buckets[${binding}].bucket_name`,
    name: bucketName,
  })),
  ...config.queueNames.map((name) => ({
    kind: 'queues' as const,
    path: `${section}.queues`,
    name,
  })),
];

const referencedNamesOf = (input: ContractInput): ReadonlySet<string> =>
  new Set(
    workerFilesOf(input).flatMap(({ config }) =>
      referencesOf(config, sectionOf(input)).map(({ name }) => name),
    ),
  );

const unknownResourceNames: Rule = (input) =>
  workerFilesOf(input).flatMap(({ file, config }) =>
    referencesOf(config, sectionOf(input)).flatMap(({ kind, path, name }) => {
      const names = catalogNamesOf(input.catalog, kind);
      return names.includes(name)
        ? []
        : [violation('C1', file, path, name, oneOf(names))];
    }),
  );

const unreferencedResources: Rule = (input) => {
  const referenced = referencedNamesOf(input);
  const catalogFile = resourceCatalogPath(input.catalog.environment);
  return CATALOG_RESOURCE_KINDS.flatMap((kind) =>
    Object.entries(input.catalog[kind]).flatMap(([key, { name }]) =>
      referenced.has(name)
        ? []
        : [
            violation(
              'C2',
              catalogFile,
              `${kind}.${key}.name`,
              '参照なし',
              `いずれかのWorkerから${name}への参照`,
            ),
          ],
    ),
  );
};

const r2Jurisdictions: Rule = (input) => {
  const expected = input.catalog.jurisdiction;
  return workerFilesOf(input).flatMap(({ file, config }) =>
    config.r2.flatMap(({ binding, jurisdiction }) =>
      jurisdiction === expected
        ? []
        : [
            violation(
              'C3',
              file,
              `${sectionOf(input)}.r2_buckets[${binding}].jurisdiction`,
              jurisdiction ?? '',
              expected,
            ),
          ],
    ),
  );
};

const workerNames: Rule = (input) => {
  const catalogWorkerNames = WORKER_KEYS.map(
    (key) => input.catalog.workers[key].name,
  );
  return WORKER_KEYS.flatMap((key) => {
    const { file, config } = input.workers[key];
    const expectedName = input.catalog.workers[key].name;
    return [
      ...(config.workerName === expectedName
        ? []
        : [
            violation(
              'C4',
              file,
              config.sourcePaths.name,
              config.workerName,
              expectedName,
            ),
          ]),
      ...config.services.flatMap((service, index) =>
        catalogWorkerNames.includes(service)
          ? []
          : [
              violation(
                'C4',
                file,
                `${sectionOf(input)}.services[${String(index)}].service`,
                service,
                oneOf(catalogWorkerNames),
              ),
            ],
      ),
    ];
  });
};

const flagText = (value: boolean | undefined): string =>
  value === undefined ? '' : String(value);

const publicUrls: Rule = (input) =>
  workerFilesOf(input).flatMap(({ file, config }) => [
    ...(config.workersDev === false
      ? []
      : [
          violation(
            'C5',
            file,
            config.sourcePaths.workersDev,
            flagText(config.workersDev),
            'false',
          ),
        ]),
    ...(config.previewUrls === false
      ? []
      : [
          violation(
            'C5',
            file,
            config.sourcePaths.previewUrls,
            flagText(config.previewUrls),
            'false',
          ),
        ]),
    ...(config.hasRoutes
      ? [violation('C5', file, config.sourcePaths.routes, 'あり', 'なし')]
      : []),
  ]);

const sharedDatabaseIds: Rule = (input) => {
  const { api, event } = input.workers;
  return event.config.d1.flatMap(({ binding, databaseName, databaseId }) => {
    const apiDatabase = api.config.d1.find(
      (database) => database.databaseName === databaseName,
    );
    if (
      apiDatabase === undefined ||
      apiDatabase.databaseId === databaseId ||
      isPlaceholderId(apiDatabase.databaseId) ||
      isPlaceholderId(databaseId)
    ) {
      return [];
    }
    return [
      violation(
        'C6',
        event.file,
        `${sectionOf(input)}.d1_databases[${binding}].database_id`,
        databaseId,
        apiDatabase.databaseId,
      ),
    ];
  });
};

interface BackendSettings {
  readonly bucket: string | undefined;
  readonly key: string | undefined;
  readonly endpoint: string | undefined;
}

const attributeOf = (hcl: string, name: string): string | undefined =>
  new RegExp(String.raw`(?:^|[\s{,])${name}\s*=\s*"([^"]*)"`).exec(hcl)?.[1];

// HCLの部分設定のうち、最上位の文字列の属性とendpointsのブロックの属性だけを読む
const readBackendSettings = (text: string): BackendSettings => {
  const hcl = text.replaceAll(/^\s*(?:#|\/\/).*$/gm, '');
  const endpoints = /(?:^|\s)endpoints\s*=\s*\{([^}]*)\}/.exec(hcl)?.[1];
  const topLevel = hcl.replaceAll(/\{[^}]*\}/g, '{}');
  return {
    bucket: attributeOf(topLevel, 'bucket'),
    key: attributeOf(topLevel, 'key'),
    endpoint:
      endpoints === undefined ? undefined : attributeOf(endpoints, 's3'),
  };
};

// 資源一覧のアカウントが仮の値の間は期待する接続先が決まらないため、R2の接続先の形であることだけを求める
const isUndeterminedEndpoint = (
  endpoint: string | undefined,
  accountId: string,
): boolean =>
  isPlaceholderId(accountId) && R2_ENDPOINT_PATTERN.test(endpoint ?? '');

const backendSettings: Rule = (input) => {
  const { catalog, backendFile } = input;
  const settings = readBackendSettings(backendFile.text);
  const { accountId } = catalog.cloudflare;
  const checks = [
    { path: 'bucket', actual: settings.bucket, expected: catalog.state.bucket },
    { path: 'key', actual: settings.key, expected: catalog.state.key },
    {
      path: 'endpoints.s3',
      actual: settings.endpoint,
      expected: `https://${accountId}.r2.cloudflarestorage.com`,
      skip: isUndeterminedEndpoint(settings.endpoint, accountId),
    },
  ];
  return checks.flatMap(({ path, actual, expected, skip = false }) =>
    skip || actual === expected
      ? []
      : [violation('C7', backendFile.file, path, actual ?? '', expected)],
  );
};

const emailEventsConsumer: Rule = (input) => {
  const { catalog } = input;
  const queueName = catalog.queues[catalog.emailSending.eventsQueue]?.name;
  const { file, config } = input.workers.event;
  if (queueName === undefined || config.queueConsumers.includes(queueName)) {
    return [];
  }
  return [
    violation(
      'C8',
      file,
      `${sectionOf(input)}.queues.consumers`,
      config.queueConsumers.join('・'),
      queueName,
    ),
  ];
};

const RULES: readonly Rule[] = [
  unknownResourceNames,
  unreferencedResources,
  r2Jurisdictions,
  workerNames,
  publicUrls,
  sharedDatabaseIds,
  backendSettings,
  emailEventsConsumer,
];

export function checkConfigContract(
  input: ContractInput,
): readonly ContractViolation[] {
  return RULES.flatMap((rule) => rule(input));
}
