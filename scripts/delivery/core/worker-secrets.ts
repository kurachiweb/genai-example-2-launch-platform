import type { WorkerKey } from '../catalog/resource-catalog.ts';
import {
  type SecretEntry,
  WORKER_SCOPED_SECRETS,
  layerWorkerSecrets,
} from './secret-scope.ts';

export const OPTIONAL_WORKER_SECRETS: Readonly<
  Record<WorkerKey, readonly string[]>
> = {
  api: ['DISIFY_API_KEY'],
  event: [
    'EMAIL_SMOKE_TOKEN',
    'EMAIL_SMOKE_RECIPIENT',
    'MEDIA_SMOKE_TOKEN',
    'DISIFY_API_KEY',
  ],
  client: [],
  admin: [],
};

export type WorkerSecretSelection =
  | { readonly ok: true; readonly secrets: Readonly<Record<string, string>> }
  | { readonly ok: false; readonly missing: readonly string[] };

export function selectWorkerSecrets({
  required,
  optional,
  shared,
  perWorker,
}: {
  readonly required: readonly string[];
  readonly optional: readonly string[];
  readonly shared: readonly SecretEntry[];
  readonly perWorker: readonly SecretEntry[];
}): WorkerSecretSelection {
  const available = new Map(
    layerWorkerSecrets({
      shared,
      perWorker,
      workerScoped: WORKER_SCOPED_SECRETS,
    }).map(({ key, value }) => [key, value]),
  );
  const missing = [...new Set(required)].filter((key) => !available.has(key));
  if (missing.length > 0) return { ok: false, missing };
  const declared = [...new Set([...required, ...optional])];
  return {
    ok: true,
    secrets: Object.fromEntries(
      declared.flatMap((key) => {
        const value = available.get(key);
        return value === undefined ? [] : [[key, value]];
      }),
    ),
  };
}
