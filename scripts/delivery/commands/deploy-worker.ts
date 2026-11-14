import { resolve } from 'node:path';

import {
  DEPLOY_ENVIRONMENTS,
  type DeployEnvironment,
  WORKER_KEYS,
  type WorkerKey,
} from '../catalog/resource-catalog.ts';
import { type DeployOutput, parseDeployOutput } from '../core/deploy-output.ts';
import { isCommitSha } from '../core/previous-release.ts';
import {
  type SecretFolder,
  SHARED_SECRET_FOLDER,
  WORKER_SCOPED_SECRETS,
  WORKER_SECRET_FOLDERS,
} from '../core/secret-scope.ts';
import { VITE_BUILT_WORKERS, appDirOf } from '../core/worker-apps.ts';
import {
  OPTIONAL_WORKER_SECRETS,
  selectWorkerSecrets,
} from '../core/worker-secrets.ts';
import {
  CLOUDFLARE_ACCOUNT_ID_KEY,
  openCloudflareSecrets,
} from './shared/cloudflare-secrets.ts';
import { loadWorkerConfig } from './shared/contract-input.ts';
import {
  type DeliveryCommand,
  type DeliveryDeps,
  EXIT_FAILURE,
  EXIT_SUCCESS,
} from './shared/delivery-command.ts';
import {
  BUN,
  runInTarget,
  stepLineOf,
  type TargetStep,
} from './shared/install-targets.ts';
import { loadResourceCatalog } from './shared/load-catalog.ts';
import { parseOptions, requiredChoice } from './shared/parse-options.ts';
import { generateAllowlist } from './shared/previous-release-allowlist.ts';
import { reportInputErrors } from './shared/report-violations.ts';

const NAME = 'deploy-worker';
const TITLE = 'Workerのデプロイ';
const SECRETS_FROM_STDIN = '/dev/stdin';
const UNREADABLE = '(読み取れませんでした)';
const RUN_ENV_KEYS = [
  'GITHUB_SHA',
  'GITHUB_SERVER_URL',
  'GITHUB_REPOSITORY',
  'GITHUB_RUN_ID',
] as const;

interface VersionAnnotation {
  readonly commit: string;
  readonly message: string;
}

interface DeployTarget {
  readonly env: DeployEnvironment;
  readonly app: WorkerKey;
  readonly accountId: string;
  readonly workerName: string;
  readonly appDir: string;
  readonly requiredSecrets: readonly string[];
  readonly clientWorker: { readonly name: string; readonly appDir: string };
}

const writeError = (message: string, deps: DeliveryDeps): void => {
  deps.stderr.write(`${NAME}: ${message}\n`);
};

// 版のタグにコミットを、メッセージにコミットと実行のURLを付け、直前のリリースの特定とロールバックの手掛かりにする
const annotationOf = (deps: DeliveryDeps): VersionAnnotation | undefined => {
  const value = (key: (typeof RUN_ENV_KEYS)[number]): string =>
    deps.env[key] ?? '';
  const missing = RUN_ENV_KEYS.filter((key) => value(key) === '');
  if (missing.length > 0) {
    writeError(
      `版に記録する実行の情報の環境変数がありません: ${missing.join('・')}。GitHub Actionsの中で実行してください。`,
      deps,
    );
    return undefined;
  }
  const commit = value('GITHUB_SHA');
  if (!isCommitSha(commit)) {
    writeError('GITHUB_SHAが40桁の16進のコミットではありません。', deps);
    return undefined;
  }
  const runUrl = `${value('GITHUB_SERVER_URL')}/${value('GITHUB_REPOSITORY')}/actions/runs/${value('GITHUB_RUN_ID')}`;
  return { commit, message: `${commit} ${runUrl}` };
};

const loadDeployTarget = async (
  env: DeployEnvironment,
  app: WorkerKey,
  deps: DeliveryDeps,
): Promise<DeployTarget | number> => {
  const catalog = await loadResourceCatalog(deps.files, env);
  if (!catalog.ok) return reportInputErrors(TITLE, catalog.errors, deps);
  const appDir = appDirOf(app);
  const config = await loadWorkerConfig(deps.files, env, appDir);
  if (!config.ok) return reportInputErrors(TITLE, config.errors, deps);
  return {
    env,
    app,
    accountId: catalog.value.cloudflare.accountId,
    workerName: catalog.value.workers[app].name,
    appDir,
    requiredSecrets: config.value.config.requiredSecrets,
    clientWorker: {
      name: catalog.value.workers.client.name,
      appDir: appDirOf('client'),
    },
  };
};

const reportMissingSecrets = (
  { env, app }: DeployTarget,
  folders: readonly SecretFolder[],
  missing: readonly string[],
  deps: DeliveryDeps,
): number => {
  const scoped = missing.filter((key) => WORKER_SCOPED_SECRETS.includes(key));
  const lines = [
    `Infisicalの${env}の${folders.join('・')}に、${app}の必須のシークレットがありません: ${missing.join('・')}`,
    ...(scoped.length === 0
      ? []
      : [
          `${scoped.join('・')}はWorkerごとに分けるキーのため、共通のフォルダの値は使いません。Workerごとのフォルダへ登録してください。`,
        ]),
  ];
  for (const line of lines) writeError(line, deps);
  deps.github.summary(
    [`### ${TITLE}(${env}・${app})`, '', ...lines, ''].join('\n'),
  );
  return EXIT_FAILURE;
};

const buildStepOf = ({ env, accountId }: DeployTarget): TargetStep => ({
  args: ['run', 'build'],
  env: { CLOUDFLARE_ENV: env, [CLOUDFLARE_ACCOUNT_ID_KEY]: accountId },
});

const deployArgsOf = (
  { env, app }: DeployTarget,
  { commit, message }: VersionAnnotation,
): readonly string[] => [
  'x',
  'wrangler',
  'deploy',
  ...(VITE_BUILT_WORKERS.has(app) ? [] : ['--env', env]),
  '--tag',
  commit,
  '--message',
  message,
  '--secrets-file',
  SECRETS_FROM_STDIN,
];

const withNewline = (text: string): string =>
  text === '' || text.endsWith('\n') ? text : `${text}\n`;

const warnUnreadable = (output: DeployOutput, deps: DeliveryDeps): void => {
  const unreadable = [
    ...(output.versionId === undefined ? ['版のID'] : []),
    ...(output.startupTimeMs === undefined ? ['起動時間'] : []),
  ];
  if (unreadable.length > 0) {
    writeError(
      `デプロイの出力から${unreadable.join('・')}を読み取れませんでした。`,
      deps,
    );
  }
};

const reportDeployed = (
  { env, app, workerName }: DeployTarget,
  { commit }: VersionAnnotation,
  output: DeployOutput,
  deps: DeliveryDeps,
): void => {
  warnUnreadable(output, deps);
  const startupTime =
    output.startupTimeMs === undefined
      ? UNREADABLE
      : `${String(output.startupTimeMs)} ms`;
  const rows: readonly (readonly [string, string])[] = [
    ['Worker', workerName],
    ['版のID', output.versionId ?? UNREADABLE],
    ['コミット', commit],
    ['起動時間', startupTime],
  ];
  const title = `${TITLE}(${env}・${app})`;
  deps.stdout.write(
    `${title}: ${rows.map(([label, value]) => `${label} ${value}`).join('、')}\n`,
  );
  deps.github.summary(
    [
      `### ${title}`,
      '',
      '| 項目 | 値 |',
      '| --- | --- |',
      ...rows.map(([label, value]) => `| ${label} | ${value} |`),
      '',
    ].join('\n'),
  );
};

const deploy = async (
  target: DeployTarget,
  annotation: VersionAnnotation,
  secrets: Readonly<Record<string, string>>,
  cloudflareEnv: Readonly<Record<string, string>>,
  deps: DeliveryDeps,
): Promise<number> => {
  const args = deployArgsOf(target, annotation);
  const line = [BUN, ...args].join(' ');
  deps.stdout.write(`$ (${target.appDir}) ${line}\n`);
  deps.stdout.write(
    `${NAME}: ${String(Object.keys(secrets).length)}件のシークレット(${Object.keys(secrets).join('・')})を標準入力で渡します。\n`,
  );
  // シークレットのJSONを引数・環境変数・ファイルに置かず、Wranglerが/dev/stdinとして読む標準入力だけで渡す
  const result = await deps.runner.run({
    command: BUN,
    args,
    cwd: resolve(deps.repoRoot, target.appDir),
    env: cloudflareEnv,
    stdin: JSON.stringify(secrets),
    output: 'capture',
  });
  deps.stdout.write(withNewline(result.stdout));
  deps.stderr.write(withNewline(result.stderr));
  if (result.code !== 0) {
    writeError(
      `${line} が終了コード${String(result.code)}で失敗しました。`,
      deps,
    );
    return EXIT_FAILURE;
  }
  reportDeployed(target, annotation, parseDeployOutput(result.stdout), deps);
  return EXIT_SUCCESS;
};

const prepare = async (
  target: DeployTarget,
  cloudflareEnv: Readonly<Record<string, string>>,
  deps: DeliveryDeps,
): Promise<number> => {
  if (target.app === 'api') {
    return generateAllowlist(
      NAME,
      {
        env: target.env,
        apiDir: target.appDir,
        clientWorker: target.clientWorker,
        cloudflareEnv,
      },
      deps,
    );
  }
  if (!VITE_BUILT_WORKERS.has(target.app)) return EXIT_SUCCESS;
  const build = buildStepOf(target);
  const code = await runInTarget(target.appDir, build, deps);
  if (code === 0) return EXIT_SUCCESS;
  writeError(
    `(${target.appDir}) ${stepLineOf(build)} が終了コード${String(code)}で失敗しました。`,
    deps,
  );
  return EXIT_FAILURE;
};

const deployWorker = async (
  env: DeployEnvironment,
  app: WorkerKey,
  deps: DeliveryDeps,
): Promise<number> => {
  const annotation = annotationOf(deps);
  if (annotation === undefined) return EXIT_FAILURE;
  const target = await loadDeployTarget(env, app, deps);
  if (typeof target === 'number') return target;
  const workerFolder = WORKER_SECRET_FOLDERS[app];
  const folders: readonly SecretFolder[] =
    workerFolder === undefined
      ? [SHARED_SECRET_FOLDER]
      : [SHARED_SECRET_FOLDER, workerFolder];
  const opened = await openCloudflareSecrets(
    NAME,
    env,
    target.accountId,
    folders,
    deps,
  );
  if (typeof opened === 'number') return opened;
  const [shared = [], perWorker = []] = opened.folders;
  const selection = selectWorkerSecrets({
    required: target.requiredSecrets,
    optional: OPTIONAL_WORKER_SECRETS[app],
    shared,
    perWorker,
  });
  if (!selection.ok) {
    return reportMissingSecrets(target, folders, selection.missing, deps);
  }
  const prepared = await prepare(target, opened.cloudflareEnv, deps);
  if (prepared !== EXIT_SUCCESS) return prepared;
  return deploy(
    target,
    annotation,
    selection.secrets,
    opened.cloudflareEnv,
    deps,
  );
};

export const command: DeliveryCommand = {
  name: NAME,
  description:
    '宣言した必須と任意のシークレット(Workerごとのフォルダを優先)を標準入力で渡し、コミットのタグと実行のURLを付けて1つのWorkerをデプロイし、版のIDと起動時間を要約に書く(apiはclientのWorkerの版から特定した直前のリリースを含めて許可リストを生成してから、client・adminは環境を指定してビルドしてから)',
  run: async (args, deps) => {
    const { options } = parseOptions(args, {
      names: ['env', 'app'],
      rest: 'none',
    });
    const env = requiredChoice(options, 'env', DEPLOY_ENVIRONMENTS);
    const app = requiredChoice(options, 'app', WORKER_KEYS);
    return deployWorker(env, app, deps);
  },
};
