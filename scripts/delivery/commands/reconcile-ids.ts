import {
  DEPLOY_ENVIRONMENTS,
  type DeployEnvironment,
} from '../catalog/resource-catalog.ts';
import {
  type ResourceIdConfigs,
  formatMismatchMarkdown,
  formatMismatchTable,
  reconcileResourceIds,
} from '../core/resource-ids.ts';
import { loadWorkerConfigs } from './shared/contract-input.ts';
import {
  type DeliveryCommand,
  type DeliveryDeps,
  EXIT_FAILURE,
  EXIT_SUCCESS,
} from './shared/delivery-command.ts';
import { loadResourceCatalog } from './shared/load-catalog.ts';
import type { Loaded } from './shared/load-input.ts';
import { parseOptions, requiredChoice } from './shared/parse-options.ts';
import { reportInputErrors } from './shared/report-violations.ts';
import {
  initTofu,
  openTofuSession,
  runTofuStep,
} from './shared/tofu-session.ts';

const NAME = 'reconcile-ids';

const titleOf = (env: DeployEnvironment): string =>
  `資源の識別子の照合(${env})`;

const loadConfigs = async (
  env: DeployEnvironment,
  deps: DeliveryDeps,
): Promise<Loaded<ResourceIdConfigs>> => {
  const catalog = await loadResourceCatalog(deps.files, env);
  return catalog.ok
    ? loadWorkerConfigs(deps.files, env, catalog.value)
    : catalog;
};

// 出力の名前を指定するとsensitiveかを判別できないため、全ての出力を取り込んでsensitiveなものを照合で飛ばす
const readOutputs = async (
  env: DeployEnvironment,
  deps: DeliveryDeps,
): Promise<string | undefined> => {
  const session = await openTofuSession(NAME, env, deps);
  if (typeof session === 'number') return undefined;
  if ((await initTofu(NAME, session, deps)) === undefined) return undefined;
  const result = await runTofuStep(
    NAME,
    {
      args: ['output', '-json', '-no-color'],
      env: session.stateEnv,
      output: 'capture',
    },
    deps,
  );
  return result?.stdout;
};

export const command: DeliveryCommand = {
  name: NAME,
  description:
    '/ci/tofuの値でOpenTofuの出力resource_idsを読み、Wrangler設定のD1・Turnstileのサイトキー・アクセス解析のトークンと照合する',
  run: async (args, deps) => {
    const { options } = parseOptions(args, { names: ['env'], rest: 'none' });
    const env = requiredChoice(options, 'env', DEPLOY_ENVIRONMENTS);
    const title = titleOf(env);
    const configs = await loadConfigs(env, deps);
    if (!configs.ok) return reportInputErrors(title, configs.errors, deps);
    const outputsJson = await readOutputs(env, deps);
    if (outputsJson === undefined) return EXIT_FAILURE;
    const mismatches = reconcileResourceIds(outputsJson, configs.value, env);
    if ('error' in mismatches) {
      deps.stderr.write(`${NAME}: ${mismatches.error}\n`);
      return EXIT_FAILURE;
    }
    deps.github.summary(formatMismatchMarkdown(title, mismatches));
    const report = `${title}: ${formatMismatchTable(mismatches)}`;
    if (mismatches.length > 0) {
      deps.stderr.write(report);
      return EXIT_FAILURE;
    }
    deps.stdout.write(report);
    return EXIT_SUCCESS;
  },
};
