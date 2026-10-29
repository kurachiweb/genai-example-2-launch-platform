import type { RepoFiles } from '../adapters/repo-files.ts';
import {
  DEPLOY_ENVIRONMENTS,
  type DeployEnvironment,
  WORKER_KEYS,
  type WorkerKey,
} from '../catalog/resource-catalog.ts';
import {
  type ContractInput,
  type WorkerConfigFile,
  checkConfigContract,
} from '../core/config-contract.ts';
import type { ContractViolation } from '../core/violation.ts';
import { readEffectiveConfig } from '../core/wrangler-config.ts';
import { type DeliveryCommand, UsageError } from './shared/delivery-command.ts';
import { loadResourceCatalog, withPath } from './shared/load-catalog.ts';
import {
  type Loaded,
  allLoaded,
  errorsOf,
  failed,
  loaded,
  readInput,
} from './shared/load-input.ts';
import {
  reportInputErrors,
  reportViolations,
} from './shared/report-violations.ts';

const TITLE = '構成検査';

const WRANGLER_CONFIG_FILE = 'wrangler.jsonc';

export const backendSettingsPath = (env: DeployEnvironment): string =>
  `apps/infra/backends/${env}.s3.hcl`;

const loadWorker = async (
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

const loadContractInput = async (
  files: RepoFiles,
  env: DeployEnvironment,
): Promise<Loaded<ContractInput>> => {
  const catalog = await loadResourceCatalog(files, env);
  if (!catalog.ok) return catalog;
  const [workers, backendFile] = await Promise.all([
    Promise.all(
      WORKER_KEYS.map((key) =>
        loadWorker(files, env, catalog.value.workers[key].appDir),
      ),
    ).then(allLoaded),
    loadBackend(files, env),
  ]);
  if (!workers.ok || !backendFile.ok) {
    return failed(errorsOf([workers, backendFile]));
  }
  return loaded({
    catalog: catalog.value,
    workers: workersOf(workers.value),
    backendFile: backendFile.value,
  });
};

const keyOf = ({ rule, file, path, actual, expected }: ContractViolation) =>
  JSON.stringify([rule, file, path, actual, expected]);

// 環境の節に無い継承するキーは両環境で同じ最上位の項目を指すため、同じ行を1件にまとめる
const uniqueViolations = (
  violations: readonly ContractViolation[],
): readonly ContractViolation[] => [
  ...new Map(
    violations.map((violation) => [keyOf(violation), violation]),
  ).values(),
];

export const command: DeliveryCommand = {
  name: 'contract-check',
  description:
    '両環境の資源一覧・4アプリのWrangler設定・backend設定の食い違いを検査する',
  run: async (args, deps) => {
    if (args.length > 0) {
      throw new UsageError(`引数は受け取りません: ${args.join(' ')}`);
    }
    const inputs = allLoaded(
      await Promise.all(
        DEPLOY_ENVIRONMENTS.map((env) => loadContractInput(deps.files, env)),
      ),
    );
    if (!inputs.ok) return reportInputErrors(TITLE, inputs.errors, deps);
    return reportViolations(
      TITLE,
      uniqueViolations(
        inputs.value.flatMap((input) => checkConfigContract(input)),
      ),
      deps,
    );
  },
};
