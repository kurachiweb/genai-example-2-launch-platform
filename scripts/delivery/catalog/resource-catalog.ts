export const DEPLOY_ENVIRONMENTS = ['staging', 'prod'] as const;
export type DeployEnvironment = (typeof DEPLOY_ENVIRONMENTS)[number];

export const WORKER_KEYS = ['api', 'event', 'client', 'admin'] as const;
export type WorkerKey = (typeof WORKER_KEYS)[number];

export type Jurisdiction = 'us';

export const EMAIL_SENDING_EVENTS = [
  'message.bounced',
  'message.complained',
  'message.rejected',
  'message.failed',
] as const;
export type EmailSendingEvent = (typeof EMAIL_SENDING_EVENTS)[number];

export interface NamedResource {
  readonly name: string;
}

export interface HostnameAssignment {
  readonly hostname: string;
  readonly worker: WorkerKey;
}

export interface ResourceCatalog {
  readonly environment: DeployEnvironment;
  readonly cloudflare: {
    readonly accountId: string;
    readonly zoneId: string;
    readonly zoneName: string;
  };
  readonly jurisdiction: Jurisdiction;
  readonly d1: Readonly<Record<string, NamedResource>>;
  readonly r2: Readonly<Record<string, NamedResource>>;
  readonly queues: Readonly<Record<string, NamedResource>>;
  readonly workers: Readonly<Record<WorkerKey, NamedResource>>;
  readonly hostnames: Readonly<Record<string, HostnameAssignment>>;
  readonly turnstile: {
    readonly name: string;
    readonly hostnames: readonly string[];
    readonly mode: 'invisible';
  };
  readonly webAnalytics: { readonly hostname: string };
  readonly emailSending: {
    readonly domain: string;
    readonly eventsQueue: string;
    readonly events: readonly EmailSendingEvent[];
    readonly subscriptionName: string;
  };
  readonly state: { readonly bucket: string; readonly key: string };
  readonly infisical: {
    readonly host: string;
    readonly projectId: string;
    readonly identityId: string;
    readonly oidcAudience: string;
  };
  readonly github: {
    readonly environment: DeployEnvironment;
    readonly branch: 'main' | 'prod';
  };
}

export type CatalogParseResult =
  | { readonly ok: true; readonly catalog: ResourceCatalog }
  | { readonly ok: false; readonly errors: readonly string[] };

export const resourceCatalogPath = (env: DeployEnvironment): string =>
  `apps/infra/environments/${env}.json`;

const UUID_PATTERN =
  /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/;

const PLACEHOLDER_ID_PATTERN = /^(?:0{8}-0{4}-0{4}-0{4}-0{12}|0{32})$/;

export const isUuid = (value: string): boolean => UUID_PATTERN.test(value);

export const isPlaceholderId = (value: string): boolean =>
  PLACEHOLDER_ID_PATTERN.test(value);

type Parsed<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly string[] };

type Reader<T> = (value: unknown, path: string) => Parsed<T>;

const ROOT_LABEL = '(最上位)';

const describeValue = (value: unknown): string =>
  value === undefined ? '(なし)' : JSON.stringify(value);

const success = <T>(value: T): Parsed<T> => ({ ok: true, value });

const failure = (path: string, reason: string): Parsed<never> => ({
  ok: false,
  errors: [`${path === '' ? ROOT_LABEL : path}: ${reason}`],
});

const errorsOf = (results: readonly Parsed<unknown>[]): readonly string[] =>
  results.flatMap((result) => (result.ok ? [] : result.errors));

const childPath = (path: string, key: string): string =>
  path === '' ? key : `${path}.${key}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const matching =
  (pattern: RegExp, expectation: string): Reader<string> =>
  (value, path) =>
    typeof value === 'string' && pattern.test(value)
      ? success(value)
      : failure(
          path,
          `${expectation}が必要です(実際: ${describeValue(value)})`,
        );

const oneOf =
  <const T extends string>(choices: readonly T[]): Reader<T> =>
  (value, path) => {
    const choice = choices.find((candidate) => candidate === value);
    return choice === undefined
      ? failure(
          path,
          `${choices.map((candidate) => JSON.stringify(candidate)).join('・')}のいずれかが必要です(実際: ${describeValue(value)})`,
        )
      : success(choice);
  };

type Shape<T> = { readonly [K in keyof T]-?: Reader<T[K]> };

const readFields = <T extends object>(
  shape: Shape<T>,
  value: Record<string, unknown>,
  path: string,
): Parsed<T> => {
  const fields = (Object.keys(shape) as (keyof T & string)[]).map((key) => {
    const fieldPath = childPath(path, key);
    const field = value[key];
    return [
      key,
      Object.hasOwn(value, key) && field !== undefined
        ? shape[key](field, fieldPath)
        : failure(fieldPath, '必須の項目がありません'),
    ] as const;
  });
  const errors = errorsOf(fields.map(([, result]) => result));
  if (errors.length > 0) return { ok: false, errors };
  return success(
    Object.fromEntries(
      fields.map(([key, result]) => [
        key,
        result.ok ? result.value : undefined,
      ]),
    ) as T,
  );
};

const object =
  <T extends object>(
    shape: Shape<T>,
    options: { readonly exact?: boolean } = {},
  ): Reader<T> =>
  (value, path) => {
    if (!isRecord(value)) {
      return failure(
        path,
        `オブジェクトが必要です(実際: ${describeValue(value)})`,
      );
    }
    const unknownKeys = options.exact
      ? Object.keys(value).filter((key) => !Object.hasOwn(shape, key))
      : [];
    const fields = readFields(shape, value, path);
    const unknownErrors = unknownKeys.map(
      (key) => `${childPath(path, key)}: 未知の項目です`,
    );
    if (unknownErrors.length === 0) return fields;
    return { ok: false, errors: [...errorsOf([fields]), ...unknownErrors] };
  };

const MAP_KEY_PATTERN = /^[a-z][\da-z-]*$/;

const recordOf =
  <T>(item: Reader<T>): Reader<Readonly<Record<string, T>>> =>
  (value, path) => {
    if (!isRecord(value)) {
      return failure(
        path,
        `オブジェクトが必要です(実際: ${describeValue(value)})`,
      );
    }
    const entries = Object.entries(value).map(([key, entry]) => {
      const entryPath = childPath(path, key);
      return [
        key,
        MAP_KEY_PATTERN.test(key)
          ? item(entry, entryPath)
          : failure(
              entryPath,
              '英小文字で始まり英小文字・数字・ハイフンだけから成るキーが必要です',
            ),
      ] as const;
    });
    const errors = errorsOf(entries.map(([, result]) => result));
    if (errors.length > 0) return { ok: false, errors };
    return success(
      Object.fromEntries(
        entries.flatMap(([key, result]) =>
          result.ok ? [[key, result.value]] : [],
        ),
      ),
    );
  };

const nonEmptyArrayOf =
  <T>(item: Reader<T>): Reader<readonly T[]> =>
  (value, path) => {
    if (!Array.isArray(value)) {
      return failure(path, `配列が必要です(実際: ${describeValue(value)})`);
    }
    if (value.length === 0) return failure(path, '1つ以上の要素が必要です');
    const items = value.map((entry: unknown, index) =>
      item(entry, `${path}[${String(index)}]`),
    );
    const errors = errorsOf(items);
    if (errors.length > 0) return { ok: false, errors };
    return success(
      items.flatMap((result) => (result.ok ? [result.value] : [])),
    );
  };

const nonEmptyString = matching(/\S/, '空でない文字列');

const uuid = matching(UUID_PATTERN, '英小文字の16進のUUID');

const cloudflareId = matching(/^[\da-f]{32}$/, '英小文字の16進32桁の識別子');

const DOMAIN_LABEL = String.raw`[\da-z](?:[\da-z-]{0,61}[\da-z])?`;

const domainName = matching(
  new RegExp(String.raw`^${DOMAIN_LABEL}(?:\.${DOMAIN_LABEL})+$`),
  '英小文字のドメイン名',
);

const httpsUrl = matching(/^https:\/\/\S+$/, 'https://で始まるURL');

const namedResource = object<NamedResource>({ name: nonEmptyString });

// アプリのディレクトリはアプリの一覧(config/workspace-layout.ts)から引くため、資源一覧には名前だけを書く
const workerResource = object<NamedResource>(
  { name: nonEmptyString },
  { exact: true },
);

const readCatalogShape = object<ResourceCatalog>({
  environment: oneOf(DEPLOY_ENVIRONMENTS),
  cloudflare: object({
    accountId: cloudflareId,
    zoneId: cloudflareId,
    zoneName: domainName,
  }),
  jurisdiction: oneOf(['us']),
  d1: recordOf(namedResource),
  r2: recordOf(namedResource),
  queues: recordOf(namedResource),
  workers: object<ResourceCatalog['workers']>(
    {
      api: workerResource,
      event: workerResource,
      client: workerResource,
      admin: workerResource,
    },
    { exact: true },
  ),
  hostnames: recordOf(
    object<HostnameAssignment>({
      hostname: domainName,
      worker: oneOf(WORKER_KEYS),
    }),
  ),
  turnstile: object({
    name: nonEmptyString,
    hostnames: nonEmptyArrayOf(domainName),
    mode: oneOf(['invisible']),
  }),
  webAnalytics: object({ hostname: domainName }),
  emailSending: object({
    domain: domainName,
    eventsQueue: nonEmptyString,
    events: nonEmptyArrayOf(oneOf(EMAIL_SENDING_EVENTS)),
    subscriptionName: nonEmptyString,
  }),
  state: object({ bucket: nonEmptyString, key: nonEmptyString }),
  infisical: object({
    host: httpsUrl,
    projectId: uuid,
    identityId: uuid,
    oidcAudience: nonEmptyString,
  }),
  github: object({
    environment: oneOf(DEPLOY_ENVIRONMENTS),
    branch: oneOf(['main', 'prod']),
  }),
});

const invariantError = (path: string, reason: string): string =>
  `${path}: ${reason}`;

const zoneErrorsOf = (catalog: ResourceCatalog): readonly string[] => {
  const { zoneName } = catalog.cloudflare;
  const inZone = (hostname: string): boolean =>
    hostname.endsWith(`.${zoneName}`);
  const reason = (hostname: string): string =>
    `ゾーン"${zoneName}"の下のホスト名が必要です(実際: "${hostname}")`;
  return [
    ...Object.entries(catalog.hostnames).flatMap(([key, { hostname }]) =>
      inZone(hostname)
        ? []
        : [invariantError(`hostnames.${key}.hostname`, reason(hostname))],
    ),
    ...(inZone(catalog.emailSending.domain)
      ? []
      : [
          invariantError(
            'emailSending.domain',
            reason(catalog.emailSending.domain),
          ),
        ]),
  ];
};

const referenceErrorsOf = (catalog: ResourceCatalog): readonly string[] => {
  const hostnames = new Set(
    Object.values(catalog.hostnames).map(({ hostname }) => hostname),
  );
  const notAssigned = (hostname: string): string =>
    `hostnamesのいずれかのホスト名が必要です(実際: "${hostname}")`;
  const { eventsQueue, events } = catalog.emailSending;
  return [
    ...catalog.turnstile.hostnames.flatMap((hostname, index) =>
      hostnames.has(hostname)
        ? []
        : [
            invariantError(
              `turnstile.hostnames[${String(index)}]`,
              notAssigned(hostname),
            ),
          ],
    ),
    ...(hostnames.has(catalog.webAnalytics.hostname)
      ? []
      : [
          invariantError(
            'webAnalytics.hostname',
            notAssigned(catalog.webAnalytics.hostname),
          ),
        ]),
    ...(Object.hasOwn(catalog.queues, eventsQueue)
      ? []
      : [
          invariantError(
            'emailSending.eventsQueue',
            `queuesのキーが必要です(実際: "${eventsQueue}")`,
          ),
        ]),
    ...events.flatMap((event, index) =>
      events.indexOf(event) === index
        ? []
        : [
            invariantError(
              `emailSending.events[${String(index)}]`,
              `重複しない種類が必要です(実際: "${event}")`,
            ),
          ],
    ),
  ];
};

const environmentErrorsOf = (
  catalog: ResourceCatalog,
  expectedEnvironment: DeployEnvironment | undefined,
): readonly string[] => [
  ...(expectedEnvironment === undefined ||
  catalog.environment === expectedEnvironment
    ? []
    : [
        invariantError(
          'environment',
          `資源一覧のファイル名と同じ"${expectedEnvironment}"が必要です(実際: "${catalog.environment}")`,
        ),
      ]),
  ...(catalog.github.environment === catalog.environment
    ? []
    : [
        invariantError(
          'github.environment',
          `資源一覧の環境と同じ"${catalog.environment}"が必要です(実際: "${catalog.github.environment}")`,
        ),
      ]),
];

export function parseResourceCatalog(
  json: unknown,
  expectedEnvironment?: DeployEnvironment,
): CatalogParseResult {
  const shape = readCatalogShape(json, '');
  if (!shape.ok) return shape;
  const catalog = shape.value;
  const errors = [
    ...environmentErrorsOf(catalog, expectedEnvironment),
    ...zoneErrorsOf(catalog),
    ...referenceErrorsOf(catalog),
  ];
  return errors.length > 0 ? { ok: false, errors } : { ok: true, catalog };
}
