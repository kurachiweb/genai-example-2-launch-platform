import type { DeployEnvironment } from '../catalog/resource-catalog.ts';

export interface D1Binding {
  readonly binding: string;
  readonly databaseName: string;
  readonly databaseId: string;
}

export interface R2Binding {
  readonly binding: string;
  readonly bucketName: string;
  readonly jurisdiction: string | undefined;
}

export interface InheritedKeyPaths {
  readonly name: string;
  readonly workersDev: string;
  readonly previewUrls: string;
  readonly routes: string;
}

export interface EffectiveWranglerConfig {
  readonly workerName: string;
  readonly workersDev: boolean | undefined;
  readonly previewUrls: boolean | undefined;
  readonly hasRoutes: boolean;
  readonly d1: readonly D1Binding[];
  readonly r2: readonly R2Binding[];
  readonly queueNames: readonly string[];
  readonly queueConsumers: readonly string[];
  readonly services: readonly string[];
  readonly vars: Readonly<Record<string, string>>;
  readonly requiredSecrets: readonly string[];
  readonly sourcePaths: InheritedKeyPaths;
}

export type WranglerParseResult =
  | { readonly ok: true; readonly config: EffectiveWranglerConfig }
  | { readonly ok: false; readonly error: string };

type JsonObject = Readonly<Record<string, unknown>>;

class WranglerShapeError extends Error {}

const ROOT_LABEL = '(最上位)';

const isRecord = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const describeValue = (value: unknown): string =>
  value === undefined ? '(なし)' : JSON.stringify(value);

const fail = (path: string, expectation: string, value: unknown): never => {
  throw new WranglerShapeError(
    `${path === '' ? ROOT_LABEL : path}: ${expectation}が必要です(実際: ${describeValue(value)})`,
  );
};

const objectAt = (value: unknown, path: string): JsonObject =>
  isRecord(value) ? value : fail(path, 'オブジェクト', value);

const optionalObjectAt = (value: unknown, path: string): JsonObject =>
  value === undefined ? {} : objectAt(value, path);

const stringAt = (value: unknown, path: string): string =>
  typeof value === 'string' ? value : fail(path, '文字列', value);

const optionalStringAt = (value: unknown, path: string): string | undefined =>
  value === undefined ? undefined : stringAt(value, path);

const optionalBooleanAt = (
  value: unknown,
  path: string,
): boolean | undefined =>
  value === undefined || typeof value === 'boolean'
    ? value
    : fail(path, '真偽値', value);

const itemsAt = <T>(
  value: unknown,
  path: string,
  read: (item: unknown, itemPath: string) => T,
): readonly T[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return fail(path, '配列', value);
  return value.map((item: unknown, index) =>
    read(item, `${path}[${String(index)}]`),
  );
};

const objectsAt = <T>(
  value: unknown,
  path: string,
  read: (item: JsonObject, itemPath: string) => T,
): readonly T[] =>
  itemsAt(value, path, (item, itemPath) =>
    read(objectAt(item, itemPath), itemPath),
  );

const readD1 = (section: JsonObject, path: string): readonly D1Binding[] =>
  objectsAt(section['d1_databases'], `${path}.d1_databases`, (item, p) => ({
    binding: stringAt(item['binding'], `${p}.binding`),
    databaseName: stringAt(item['database_name'], `${p}.database_name`),
    databaseId: stringAt(item['database_id'], `${p}.database_id`),
  }));

const readR2 = (section: JsonObject, path: string): readonly R2Binding[] =>
  objectsAt(section['r2_buckets'], `${path}.r2_buckets`, (item, p) => ({
    binding: stringAt(item['binding'], `${p}.binding`),
    bucketName: stringAt(item['bucket_name'], `${p}.bucket_name`),
    jurisdiction: optionalStringAt(item['jurisdiction'], `${p}.jurisdiction`),
  }));

interface QueueUsage {
  readonly names: readonly string[];
  readonly consumers: readonly string[];
}

const readQueues = (section: JsonObject, path: string): QueueUsage => {
  const queuesPath = `${path}.queues`;
  const queues = optionalObjectAt(section['queues'], queuesPath);
  const producers = objectsAt(
    queues['producers'],
    `${queuesPath}.producers`,
    (item, p) => stringAt(item['queue'], `${p}.queue`),
  );
  const consumers = objectsAt(
    queues['consumers'],
    `${queuesPath}.consumers`,
    (item, p) => ({
      queue: stringAt(item['queue'], `${p}.queue`),
      deadLetterQueue: optionalStringAt(
        item['dead_letter_queue'],
        `${p}.dead_letter_queue`,
      ),
    }),
  );
  const consumerQueues = consumers.map(({ queue }) => queue);
  const deadLetterQueues = consumers.flatMap(({ deadLetterQueue }) =>
    deadLetterQueue === undefined ? [] : [deadLetterQueue],
  );
  return {
    names: [...new Set([...producers, ...consumerQueues, ...deadLetterQueues])],
    consumers: consumerQueues,
  };
};

const readServices = (section: JsonObject, path: string): readonly string[] =>
  objectsAt(section['services'], `${path}.services`, (item, p) =>
    stringAt(item['service'], `${p}.service`),
  );

const varValueOf = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value);

const readVars = (
  section: JsonObject,
  path: string,
): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Object.entries(optionalObjectAt(section['vars'], `${path}.vars`)).map(
      ([key, value]) => [key, varValueOf(value)],
    ),
  );

const readRequiredSecrets = (
  section: JsonObject,
  path: string,
): readonly string[] => {
  const secretsPath = `${path}.secrets`;
  const secrets = optionalObjectAt(section['secrets'], secretsPath);
  return itemsAt(secrets['required'], `${secretsPath}.required`, stringAt);
};

interface InheritedValue {
  readonly value: unknown;
  readonly path: string;
}

// 継承するキーは環境の節に書かれていればその値を、無ければ最上位の値を使う
const inheritedFrom =
  (root: JsonObject, section: JsonObject, sectionPath: string) =>
  (key: string): InheritedValue =>
    Object.hasOwn(section, key)
      ? { value: section[key], path: `${sectionPath}.${key}` }
      : { value: root[key], path: key };

const ROUTE_KEYS = ['route', 'routes'] as const;

const isPresentRoute = (value: unknown): boolean =>
  value !== undefined &&
  value !== null &&
  !(Array.isArray(value) && value.length === 0);

const routesSourcePathOf = (
  inherited: (key: string) => InheritedValue,
): string => {
  const written = ROUTE_KEYS.map(inherited).filter(
    ({ value }) => value !== undefined,
  );
  return (
    written.length === 0 ? ROUTE_KEYS : written.map(({ path }) => path)
  ).join('・');
};

const parseJsonc = (text: string): unknown => {
  try {
    return Bun.JSONC.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new WranglerShapeError(`JSONCとして解析できません(${reason})`);
  }
};

const effectiveConfigOf = (
  jsoncText: string,
  environment: DeployEnvironment,
): EffectiveWranglerConfig => {
  const root = objectAt(parseJsonc(jsoncText), '');
  const sectionPath = `env.${environment}`;
  const environments = optionalObjectAt(root['env'], 'env');
  const section = objectAt(environments[environment], sectionPath);
  const inherited = inheritedFrom(root, section, sectionPath);
  const inheritedBoolean = (key: string): boolean | undefined => {
    const { value, path } = inherited(key);
    return optionalBooleanAt(value, path);
  };
  const envName = optionalStringAt(section['name'], `${sectionPath}.name`);
  const queues = readQueues(section, sectionPath);
  return {
    workerName: envName ?? `${stringAt(root['name'], 'name')}-${environment}`,
    workersDev: inheritedBoolean('workers_dev'),
    previewUrls: inheritedBoolean('preview_urls'),
    hasRoutes: ROUTE_KEYS.some((key) => isPresentRoute(inherited(key).value)),
    d1: readD1(section, sectionPath),
    r2: readR2(section, sectionPath),
    queueNames: queues.names,
    queueConsumers: queues.consumers,
    services: readServices(section, sectionPath),
    vars: readVars(section, sectionPath),
    requiredSecrets: readRequiredSecrets(section, sectionPath),
    sourcePaths: {
      name: envName === undefined ? 'name' : `${sectionPath}.name`,
      workersDev: inherited('workers_dev').path,
      previewUrls: inherited('preview_urls').path,
      routes: routesSourcePathOf(inherited),
    },
  };
};

export function readEffectiveConfig(
  jsoncText: string,
  environment: DeployEnvironment,
): WranglerParseResult {
  try {
    return { ok: true, config: effectiveConfigOf(jsoncText, environment) };
  } catch (error) {
    if (error instanceof WranglerShapeError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}
