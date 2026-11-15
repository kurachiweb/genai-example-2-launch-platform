import {
  DEPLOY_ENVIRONMENTS,
  type DeployEnvironment,
  type ResourceCatalog,
  isPlaceholderId,
  resourceCatalogPath,
} from '../catalog/resource-catalog.ts';
import { checkConfigContract } from '../core/config-contract.ts';
import {
  backendSettingsPath,
  loadContractInput,
  uniqueViolations,
} from './shared/contract-input.ts';
import {
  type DeliveryCommand,
  type DeliveryDeps,
  EXIT_FAILURE,
  EXIT_SUCCESS,
} from './shared/delivery-command.ts';
import { parseOptions, requiredChoice } from './shared/parse-options.ts';
import {
  reportInputErrors,
  reportViolations,
} from './shared/report-violations.ts';

const NAME = 'preflight';
const REF_NAME_ENV = 'GITHUB_REF_NAME';

const branchProblems = (
  env: DeployEnvironment,
  catalog: ResourceCatalog,
  refName: string | undefined,
): readonly string[] => {
  if (refName === undefined || refName === '') {
    return [`実行中のブランチが分かりません(${REF_NAME_ENV}がありません)。`];
  }
  const expected = catalog.github.branch;
  return refName === expected
    ? []
    : [
        `実行中のブランチ${refName}が、${resourceCatalogPath(env)}のgithub.branch(${expected})と一致しません。`,
      ];
};

// prodの主体・stateの保管先はlaunch-readinessがリリースの準備で作るため、prodの仮の値は未準備として案内する
const PROD_NOT_READY =
  'prodへのデプロイの前にlaunch-readinessの準備が必要です。';

const INFISICAL_IDS = ['projectId', 'identityId'] as const;

type InfisicalIdKey = (typeof INFISICAL_IDS)[number];

const INFISICAL_NEXT_STEP: Readonly<
  Record<DeployEnvironment, Readonly<Record<InfisicalIdKey, string>>>
> = {
  staging: {
    projectId:
      '.infisical.yamlのsecrets-management.project-idと同じ値を記入してください。',
    identityId: '初回の準備で主体を作り、そのIDを記入してください。',
  },
  prod: { projectId: PROD_NOT_READY, identityId: PROD_NOT_READY },
};

const CLOUDFLARE_NEXT_STEP: Readonly<Record<DeployEnvironment, string>> = {
  staging: '本物の値を記入してください。',
  prod: `本物の値を記入してください。${PROD_NOT_READY}`,
};

// アカウントIDはstateの保管先の接続先にも含まれるため、backendの部分設定も記入先に挙げる
const cloudflareProblems = (
  env: DeployEnvironment,
  catalog: ResourceCatalog,
): readonly string[] => {
  const catalogPath = resourceCatalogPath(env);
  const destinations = {
    accountId: `${catalogPath}のcloudflare.accountIdと${backendSettingsPath(env)}のendpoints.s3`,
    zoneId: `${catalogPath}のcloudflare.zoneId`,
  } as const;
  return (['accountId', 'zoneId'] as const)
    .filter((key) => isPlaceholderId(catalog.cloudflare[key]))
    .map(
      (key) =>
        `${catalogPath}のcloudflare.${key}が仮の値です。${destinations[key]}へ${CLOUDFLARE_NEXT_STEP[env]}`,
    );
};

const identityProblems = (
  env: DeployEnvironment,
  catalog: ResourceCatalog,
): readonly string[] =>
  INFISICAL_IDS.filter((key) => isPlaceholderId(catalog.infisical[key])).map(
    (key) =>
      `${resourceCatalogPath(env)}のinfisical.${key}が仮の値です。${INFISICAL_NEXT_STEP[env][key]}`,
  );

const titleOf = (env: DeployEnvironment): string => `${env}の事前確認`;

const reportProblems = (
  env: DeployEnvironment,
  problems: readonly string[],
  branch: string,
  { stdout, stderr, github }: DeliveryDeps,
): number => {
  const title = titleOf(env);
  if (problems.length === 0) {
    stdout.write(
      `事前確認: ${env}へのデプロイの前提を満たしています(ブランチ${branch})。\n`,
    );
    github.summary(
      `### ${title}\n\nデプロイの前提を満たしています(ブランチ${branch})。\n`,
    );
    return EXIT_SUCCESS;
  }
  stderr.write(problems.map((problem) => `${NAME}: ${problem}\n`).join(''));
  github.summary(
    [`### ${title}`, '', ...problems.map((problem) => `- ${problem}`), ''].join(
      '\n',
    ),
  );
  return EXIT_FAILURE;
};

export const command: DeliveryCommand = {
  name: NAME,
  description:
    '実行中のブランチ・資源一覧の解析と構成検査・Infisicalの識別子が仮の値でないことを、デプロイの前に確かめる',
  run: async (args, deps) => {
    const { options } = parseOptions(args, { names: ['env'], rest: 'none' });
    const env = requiredChoice(options, 'env', DEPLOY_ENVIRONMENTS);
    const title = titleOf(env);
    const input = await loadContractInput(deps.files, env);
    if (!input.ok) return reportInputErrors(title, input.errors, deps);
    const { catalog } = input.value;
    const contractCode = reportViolations(
      `${title}(構成検査)`,
      uniqueViolations(checkConfigContract(input.value)),
      deps,
    );
    const refName = deps.env[REF_NAME_ENV];
    const problemsCode = reportProblems(
      env,
      [
        ...branchProblems(env, catalog, refName),
        ...cloudflareProblems(env, catalog),
        ...identityProblems(env, catalog),
      ],
      refName ?? '',
      deps,
    );
    return contractCode === EXIT_SUCCESS && problemsCode === EXIT_SUCCESS
      ? EXIT_SUCCESS
      : EXIT_FAILURE;
  },
};
