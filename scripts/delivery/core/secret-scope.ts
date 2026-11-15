import type { WorkerKey } from '../catalog/resource-catalog.ts';

export const SECRET_SCOPES = ['checks', 'staging', 'prod'] as const;
export type SecretScope = (typeof SECRET_SCOPES)[number];

export const RUN_SECRETS_SCOPES = ['checks', 'local'] as const;
export type RunSecretsScope = (typeof RUN_SECRETS_SCOPES)[number];

export type InfisicalEnvironment = 'dev' | 'staging' | 'prod';

export const ENVIRONMENT_OF_SCOPE: Readonly<
  Record<SecretScope, InfisicalEnvironment>
> = { checks: 'dev', staging: 'staging', prod: 'prod' };

export type WorkerSecretFolder = '/workers/api' | '/workers/event';
export type SecretFolder =
  '/' | WorkerSecretFolder | '/ci/tofu' | '/ci/cloudflare';

export const SHARED_SECRET_FOLDER = '/';

export const WORKER_SECRET_FOLDERS: Readonly<
  Record<WorkerKey, WorkerSecretFolder | undefined>
> = {
  api: '/workers/api',
  event: '/workers/event',
  client: undefined,
  admin: undefined,
};

export const WORKER_SCOPED_SECRETS: readonly string[] = ['STRIPE_API_KEY'];

export interface SecretEntry {
  readonly key: string;
  readonly value: string;
}

export function layerWorkerSecrets({
  shared,
  perWorker,
  workerScoped,
}: {
  readonly shared: readonly SecretEntry[];
  readonly perWorker: readonly SecretEntry[];
  readonly workerScoped: readonly string[];
}): readonly SecretEntry[] {
  const scoped = new Set(workerScoped);
  const layered = new Map<string, string>();
  for (const { key, value } of shared) {
    if (!scoped.has(key)) layered.set(key, value);
  }
  for (const { key, value } of perWorker) layered.set(key, value);
  return [...layered].map(([key, value]) => ({ key, value }));
}

const EXPORT_COMMAND = '`infisical export`';

const isSecretEntry = (value: unknown): value is SecretEntry =>
  typeof value === 'object' &&
  value !== null &&
  'key' in value &&
  typeof value.key === 'string' &&
  value.key !== '' &&
  'value' in value &&
  typeof value.value === 'string';

const shapeError = (detail: string): { readonly error: string } => ({
  error: `${EXPORT_COMMAND}の出力が想定の形ではありません(${detail})`,
});

// 解析の失敗の理由は出力の一部を引用し得るため、誤りには出力の中身を含めない
const parseJson = (json: string): { readonly value: unknown } | undefined => {
  try {
    return { value: JSON.parse(json) };
  } catch {
    return undefined;
  }
};

export function parseInfisicalExport(
  json: string,
): readonly SecretEntry[] | { readonly error: string } {
  const parsed = parseJson(json);
  if (parsed === undefined) {
    return { error: `${EXPORT_COMMAND}の出力をJSONとして解析できません` };
  }
  if (parsed.value === null) return [];
  if (!Array.isArray(parsed.value)) return shapeError('配列ではありません');
  const items: readonly unknown[] = parsed.value;
  const invalidIndex = items.findIndex((item) => !isSecretEntry(item));
  if (invalidIndex !== -1) {
    return shapeError(
      `${String(invalidIndex + 1)}番目の要素に文字列のkeyとvalueがありません`,
    );
  }
  return items.filter(isSecretEntry).map(({ key, value }) => ({ key, value }));
}

// マスクは1行ずつしか効かないため行に分け、空白だけの行はログの空白をすべて伏せてしまうため除く
export function maskableValues(
  entries: readonly SecretEntry[],
): readonly string[] {
  return [
    ...new Set(
      entries
        .flatMap(({ value }) => value.split(/\r?\n/))
        .filter((line) => line.trim() !== ''),
    ),
  ];
}
