import type { RepoFiles } from '../../adapters/repo-files.ts';
import {
  type DeployEnvironment,
  WORKER_KEYS,
  type WorkerKey,
} from '../../catalog/resource-catalog.ts';
import type {
  ContractInput,
  WorkerConfigFile,
} from '../../core/config-contract.ts';
import type { ContractViolation } from '../../core/violation.ts';
import { appDirOf } from '../../core/worker-apps.ts';
import { readEffectiveConfig } from '../../core/wrangler-config.ts';
import { loadResourceCatalog, withPath } from './load-catalog.ts';
import {
  type Loaded,
  allLoaded,
  errorsOf,
  failed,
  loaded,
  readInput,
} from './load-input.ts';

const WRANGLER_CONFIG_FILE = 'wrangler.jsonc';

export const backendSettingsPath = (env: DeployEnvironment): string =>
  `apps/infra/backends/${env}.s3.hcl`;

export const loadWorkerConfig = async (
  files: RepoFiles,
  env: DeployEnvironment,
  appDir: string,
): Promise<Loaded<WorkerConfigFile>> => {
  const file = `${appDir}/${WRANGLER_CONFIG_FILE}`;
  const text = await readInput(files, file);
  if (!text.ok) return text;
  const result = readEffectiveConfig(text.value, env);
  return result.ok
    ? loaded({ file, config: result.config })
    : failed(withPath(file, [result.error]));
};

const loadBackend = async (
  files: RepoFiles,
  env: DeployEnvironment,
): Promise<Loaded<ContractInput['backendFile']>> => {
  const file = backendSettingsPath(env);
  const text = await readInput(files, file);
  return text.ok ? loaded({ file, text: text.value }) : text;
};

const workersOf = (
  configs: readonly WorkerConfigFile[],
): Readonly<Record<WorkerKey, WorkerConfigFile>> =>
  Object.fromEntries(
    WORKER_KEYS.map((key, index) => [key, configs[index]]),
  ) as Record<WorkerKey, WorkerConfigFile>;

export async function loadWorkerConfigs(
  files: RepoFiles,
  env: DeployEnvironment,
): Promise<Loaded<Readonly<Record<WorkerKey, WorkerConfigFile>>>> {
  const workers = allLoaded(
    await Promise.all(
      WORKER_KEYS.map((key) => loadWorkerConfig(files, env, appDirOf(key))),
    ),
  );
  return workers.ok ? loaded(workersOf(workers.value)) : failed(workers.errors);
}

export async function loadContractInput(
  files: RepoFiles,
  env: DeployEnvironment,
): Promise<Loaded<ContractInput>> {
  const catalog = await loadResourceCatalog(files, env);
  if (!catalog.ok) return catalog;
  const [workers, backendFile] = await Promise.all([
    loadWorkerConfigs(files, env),
    loadBackend(files, env),
  ]);
  if (!workers.ok || !backendFile.ok) {
    return failed(errorsOf([workers, backendFile]));
  }
  return loaded({
    catalog: catalog.value,
    workers: workers.value,
    backendFile: backendFile.value,
  });
}

const keyOf = ({ rule, file, path, actual, expected }: ContractViolation) =>
  JSON.stringify([rule, file, path, actual, expected]);

// 環境の節に無い継承するキーは両環境で同じ最上位の項目を指すため、同じ行を1件にまとめる
export function uniqueViolations(
  violations: readonly ContractViolation[],
): readonly ContractViolation[] {
  return [
    ...new Map(
      violations.map((violation) => [keyOf(violation), violation]),
    ).values(),
  ];
}
