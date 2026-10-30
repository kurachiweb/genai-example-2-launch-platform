import type { CommandSpec } from '../adapters/command-runner.ts';
import {
  DEPLOY_ENVIRONMENTS,
  type DeployEnvironment,
  resourceCatalogPath,
} from '../catalog/resource-catalog.ts';
import {
  type SmokeE2ePlan,
  VERIFY_EXPECT_STATUS,
  VERIFY_WAIT_TIMEOUT_MS,
  type WaitFailure,
  smokeE2eCommandOf,
  verificationPlanFor,
  waitFailureReport,
} from '../core/verification-plan.ts';
import {
  type DeliveryCommand,
  type DeliveryDeps,
  EXIT_FAILURE,
  EXIT_SUCCESS,
} from './shared/delivery-command.ts';
import { loadResourceCatalog, withPath } from './shared/load-catalog.ts';
import { parseOptions, requiredChoice } from './shared/parse-options.ts';
import { reportInputErrors } from './shared/report-violations.ts';

const NAME = 'verify';
const TITLE = 'デプロイ後の確認';

const report = (
  deps: DeliveryDeps,
  outcome: 'success' | 'failure',
  message: string,
): number => {
  deps.github.summary(message);
  if (outcome === 'success') {
    deps.stdout.write(message);
    return EXIT_SUCCESS;
  }
  deps.stderr.write(message);
  return EXIT_FAILURE;
};

const waitAll = async (
  urls: readonly string[],
  { probe }: DeliveryDeps,
): Promise<readonly WaitFailure[]> => {
  const results = await Promise.all(
    urls.map(async (url) => {
      const { reached, lastStatus } = await probe.waitFor(url, {
        timeoutMs: VERIFY_WAIT_TIMEOUT_MS,
        expectStatus: VERIFY_EXPECT_STATUS,
      });
      return reached ? undefined : { url, lastStatus };
    }),
  );
  return results.filter((failure) => failure !== undefined);
};

const reportWaitFailures = (
  deps: DeliveryDeps,
  label: string,
  failures: readonly WaitFailure[],
): number =>
  report(
    deps,
    'failure',
    `${label}: 応答を確かめられなかった対象があります。\n${waitFailureReport(failures)}`,
  );

const verifyHealth = async (
  deps: DeliveryDeps,
  label: string,
  urls: readonly string[],
): Promise<number> => {
  const failures = await waitAll(urls, deps);
  if (failures.length > 0) return reportWaitFailures(deps, label, failures);
  const lines = urls.map((url) => `- ${url}: ${String(VERIFY_EXPECT_STATUS)}`);
  return report(
    deps,
    'success',
    `${label}: すべての対象が正常に応答しました。\n${lines.join('\n')}\n`,
  );
};

const verifySmoke = async (
  deps: DeliveryDeps,
  label: string,
  plan: SmokeE2ePlan,
): Promise<number> => {
  const failures = await waitAll([plan.waitForHealth], deps);
  if (failures.length > 0) return reportWaitFailures(deps, label, failures);
  const { command, args, env } = smokeE2eCommandOf(plan);
  const spec: CommandSpec = {
    command,
    args,
    cwd: deps.repoRoot,
    env,
    output: 'inherit',
  };
  const line = [command, ...args].join(' ');
  const targets = `client: ${plan.clientUrl}、admin: ${plan.adminUrl}`;
  deps.stdout.write(`$ ${line}(${targets})\n`);
  const { code } = await deps.runner.run(spec);
  if (code !== 0) {
    return report(
      deps,
      'failure',
      `${label}: スモークテスト(${line})が終了コード${String(code)}で失敗しました(${targets})。\n`,
    );
  }
  return report(
    deps,
    'success',
    `${label}: スモークテストが成功しました(${targets})。\n`,
  );
};

const verify = async (
  deps: DeliveryDeps,
  env: DeployEnvironment,
): Promise<number> => {
  const catalog = await loadResourceCatalog(deps.files, env);
  if (!catalog.ok) return reportInputErrors(TITLE, catalog.errors, deps);
  const planned = verificationPlanFor(catalog.value);
  if (!planned.ok) {
    return reportInputErrors(
      TITLE,
      withPath(resourceCatalogPath(env), planned.errors),
      deps,
    );
  }
  const label = `${TITLE}(${env})`;
  const { plan } = planned;
  return plan.kind === 'smoke-e2e'
    ? verifySmoke(deps, label, plan)
    : verifyHealth(deps, label, plan.urls);
};

export const command: DeliveryCommand = {
  name: NAME,
  description:
    'デプロイ後に公開のホスト名で動作を確かめる。stagingはapiのヘルスチェックを待ってから`@smoke`のE2Eを実行し、prodは両サーバーのヘルスチェックと利用者側のトップページの200を確かめる',
  run: async (args, deps) => {
    const { options } = parseOptions(args, { names: ['env'], rest: 'none' });
    const env = requiredChoice(options, 'env', DEPLOY_ENVIRONMENTS);
    return verify(deps, env);
  },
};
