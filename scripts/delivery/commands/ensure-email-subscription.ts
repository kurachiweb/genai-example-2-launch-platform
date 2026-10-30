import type { CommandResult, CommandSpec } from '../adapters/command-runner.ts';
import {
  DEPLOY_ENVIRONMENTS,
  type DeployEnvironment,
  type ResourceCatalog,
  resourceCatalogPath,
} from '../catalog/resource-catalog.ts';
import {
  type DesiredSubscription,
  EMAIL_SENDING_SOURCE,
  diffSubscription,
} from '../core/email-subscription.ts';
import { dockerfileToolVersion } from '../core/tool-versions.ts';
import { openCloudflareSecrets } from './shared/cloudflare-secrets.ts';
import {
  type DeliveryCommand,
  type DeliveryDeps,
  EXIT_FAILURE,
  EXIT_SUCCESS,
} from './shared/delivery-command.ts';
import { loadResourceCatalog } from './shared/load-catalog.ts';
import {
  type Loaded,
  errorsOf,
  failed,
  loaded,
  readInput,
} from './shared/load-input.ts';
import { parseOptions, requiredChoice } from './shared/parse-options.ts';
import { reportInputErrors } from './shared/report-violations.ts';

const NAME = 'ensure-email-subscription';
const TITLE = '配信不能イベントの購読の確認';
const WRANGLER = 'wrangler';
const DOCKERFILE_PATH = 'Dockerfile';
const VERSION_PATTERN = /\d+\.\d+\.\d+/;

const lineOf = ({ command, args }: Pick<CommandSpec, 'command' | 'args'>) =>
  [command, ...args].join(' ');

const desiredOf = (
  catalog: ResourceCatalog,
  env: DeployEnvironment,
): Loaded<DesiredSubscription> => {
  const { emailSending, queues, cloudflare } = catalog;
  const queue = queues[emailSending.eventsQueue];
  if (queue === undefined) {
    return failed([
      `${resourceCatalogPath(env)}: queuesにemailSending.eventsQueue(${emailSending.eventsQueue})がありません`,
    ]);
  }
  return loaded({
    name: emailSending.subscriptionName,
    queue: queue.name,
    zoneId: cloudflare.zoneId,
    domain: emailSending.domain,
    events: emailSending.events,
  });
};

const loadDesired = async (
  deps: DeliveryDeps,
  env: DeployEnvironment,
): Promise<Loaded<DesiredSubscription>> => {
  const catalog = await loadResourceCatalog(deps.files, env);
  return catalog.ok ? desiredOf(catalog.value, env) : catalog;
};

const loadWranglerVersion = async (
  deps: DeliveryDeps,
): Promise<Loaded<string>> => {
  const dockerfile = await readInput(deps.files, DOCKERFILE_PATH);
  if (!dockerfile.ok) return dockerfile;
  const version = dockerfileToolVersion(dockerfile.value, 'wranglerTool');
  return version.ok ? loaded(version.version) : failed([version.error]);
};

const reportFailedRun = (
  deps: DeliveryDeps,
  spec: CommandSpec,
  { code, stderr }: Pick<CommandResult, 'code' | 'stderr'>,
): number => {
  deps.stderr.write(
    `${NAME}: ${lineOf(spec)} が終了コード${String(code)}で失敗しました。\n`,
  );
  if (stderr !== '')
    deps.stderr.write(stderr.endsWith('\n') ? stderr : `${stderr}\n`);
  return EXIT_FAILURE;
};

// 購読の操作のオプションはアプリのWranglerの版では保証されないため、開発コンテナと同じ版であることを先に確かめる
const checkWranglerVersion = async (
  deps: DeliveryDeps,
  expected: string,
): Promise<number | undefined> => {
  const spec: CommandSpec = {
    command: WRANGLER,
    args: ['--version'],
    output: 'capture',
  };
  const result = await deps.runner.run(spec);
  if (result.code !== 0) return reportFailedRun(deps, spec, result);
  const actual = VERSION_PATTERN.exec(result.stdout)?.[0];
  if (actual === expected) return undefined;
  deps.stderr.write(
    `${NAME}: Wranglerの版(${actual ?? result.stdout.trim()})がDockerfileのWRANGLER_VERSION(${expected})と一致しません。\n`,
  );
  return EXIT_FAILURE;
};

const listArgsOf = ({ queue }: DesiredSubscription): readonly string[] => [
  'queues',
  'subscription',
  'list',
  queue,
  '--json',
];

const createArgsOf = ({
  queue,
  events,
  zoneId,
  domain,
  name,
}: DesiredSubscription): readonly string[] => [
  'queues',
  'subscription',
  'create',
  queue,
  '--source',
  EMAIL_SENDING_SOURCE,
  '--events',
  events.join(','),
  '--zone-id',
  zoneId,
  '--domain',
  domain,
  '--name',
  name,
];

const ensure = async (
  deps: DeliveryDeps,
  env: DeployEnvironment,
  desired: DesiredSubscription,
  cloudflareEnv: Readonly<Record<string, string>>,
): Promise<number> => {
  const base = { command: WRANGLER, cwd: deps.repoRoot, env: cloudflareEnv };
  const listSpec: CommandSpec = {
    ...base,
    args: listArgsOf(desired),
    output: 'capture',
  };
  const listed = await deps.runner.run(listSpec);
  if (listed.code !== 0) return reportFailedRun(deps, listSpec, listed);
  const state = diffSubscription(listed.stdout, desired);
  const label = `${TITLE}(${env})`;
  if ('error' in state) {
    deps.stderr.write(`${NAME}: ${state.error}\n`);
    return EXIT_FAILURE;
  }
  switch (state.kind) {
    case 'present': {
      const message = `${label}: ${desired.name}は設定どおりです。\n`;
      deps.stdout.write(message);
      deps.github.summary(message);
      return EXIT_SUCCESS;
    }
    case 'mismatch': {
      const lines = state.differences.map((difference) => `- ${difference}`);
      const message = `${label}: Queue ${desired.queue}の購読が設定と異なります。作り直すかは開発者が判断してください。\n${lines.join('\n')}\n`;
      deps.stderr.write(message);
      deps.github.summary(message);
      return EXIT_FAILURE;
    }
    case 'absent': {
      const createSpec: CommandSpec = {
        ...base,
        args: createArgsOf(desired),
        output: 'inherit',
      };
      deps.stdout.write(`$ ${lineOf(createSpec)}\n`);
      const created = await deps.runner.run(createSpec);
      if (created.code !== 0) return reportFailedRun(deps, createSpec, created);
      deps.github.summary(
        `${label}: Queue ${desired.queue}への購読${desired.name}を作成しました。\n`,
      );
      return EXIT_SUCCESS;
    }
  }
};

export const command: DeliveryCommand = {
  name: NAME,
  description:
    '送信ドメインの配信不能イベントをQueueへ届ける購読を、開発コンテナと同じ版のWranglerで確かめ、無ければ作り、異なれば差分を示して失敗する',
  run: async (args, deps) => {
    const { options } = parseOptions(args, { names: ['env'], rest: 'none' });
    const env = requiredChoice(options, 'env', DEPLOY_ENVIRONMENTS);
    const [desired, version] = await Promise.all([
      loadDesired(deps, env),
      loadWranglerVersion(deps),
    ]);
    if (!desired.ok || !version.ok) {
      return reportInputErrors(TITLE, errorsOf([desired, version]), deps);
    }
    const versionFailure = await checkWranglerVersion(deps, version.value);
    if (versionFailure !== undefined) return versionFailure;
    const secrets = await openCloudflareSecrets(NAME, env, [], deps);
    if (typeof secrets === 'number') return secrets;
    return ensure(deps, env, desired.value, secrets.cloudflareEnv);
  },
};
