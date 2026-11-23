import type { CommandRunner, CommandSpec } from '../adapters/command-runner.ts';
import { command } from '../commands/deploy-worker.ts';
import {
  type DeployEnvironment,
  WORKER_KEYS,
  type WorkerKey,
} from '../catalog/resource-catalog.ts';
import type { SecretEntry } from '../core/secret-scope.ts';
import { commandLineOf } from './command-runner.ts';
import {
  CATALOG_HOST,
  createFakeSecretSource,
  createRecordingGithub,
  folderKeyOf,
  infisicalRepoTexts,
} from './infisical.ts';
import {
  createFakeDeps,
  createFakeRepoFiles,
  FAKE_REPO_ROOT,
} from './repo-files.ts';
import { ACCOUNT_ID, PROJECT_ID } from './resource-catalog.ts';

export { FAKE_REPO_ROOT };

export const SHA = '0123456789abcdef0123456789abcdef01234567';
export const RUN_URL = 'https://github.example/example/launch/actions/runs/42';
export const GITHUB_ENV: Readonly<Record<string, string>> = {
  INFISICAL_TOKEN: 'fake-access-token',
  GITHUB_SHA: SHA,
  GITHUB_SERVER_URL: 'https://github.example',
  GITHUB_REPOSITORY: 'example/launch',
  GITHUB_RUN_ID: '42',
};

export const VERSION_ID = '01234567-89ab-4cde-8f01-23456789abcd';
const DEPLOY_STDOUT = [
  'Total Upload: 512.34 KiB / gzip: 120.11 KiB',
  'Worker Startup Time: 23 ms',
  'Your Worker has access to the following bindings:',
  'env.APP_ENVIRONMENT ("staging")      Environment Variable',
  'Uploaded app-worker (5.12 sec)',
  `Current Version ID: ${VERSION_ID}`,
  '',
].join('\n');

export const CLOUDFLARE_TOKEN = 'fake-cloudflare-api-token';
export const CLOUDFLARE_CHILD_ENV = {
  CLOUDFLARE_API_TOKEN: CLOUDFLARE_TOKEN,
  CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
};

export const CLOUDFLARE_FOLDER: readonly SecretEntry[] = [
  { key: 'CLOUDFLARE_API_TOKEN', value: CLOUDFLARE_TOKEN },
];

export const SHARED_FOLDER: readonly SecretEntry[] = [
  { key: 'HASH_PEPPER', value: 'fake-shared-pepper' },
  { key: 'SENTRY_DSN', value: 'fake-shared-sentry-dsn' },
  { key: 'STRIPE_API_KEY', value: 'fake-shared-stripe-key' },
  { key: 'DISIFY_API_KEY', value: 'fake-shared-disify-key' },
  { key: 'PRIVATE_KEY', value: 'fake-key-line-1\nfake-key-line-2' },
  { key: 'UNDECLARED_SECRET', value: 'fake-undeclared-value' },
];

export const API_FOLDER: readonly SecretEntry[] = [
  { key: 'STRIPE_API_KEY', value: 'fake-api-stripe-key' },
  { key: 'SENTRY_DSN', value: 'fake-api-sentry-dsn' },
];

export const EVENT_FOLDER: readonly SecretEntry[] = [
  { key: 'STRIPE_API_KEY', value: 'fake-event-stripe-key' },
  { key: 'EMAIL_SMOKE_TOKEN', value: 'fake-event-smoke-token' },
];

export const SENTRY_TOKEN = 'fake-sentry-auth-token';
export const SENTRY_FOLDER: readonly SecretEntry[] = [
  { key: 'SENTRY_AUTH_TOKEN', value: SENTRY_TOKEN },
  { key: 'SENTRY_ORG', value: 'example-org' },
  { key: 'SENTRY_PROJECT', value: 'example-project' },
];
export const SENTRY_CLI_ENV = {
  SENTRY_AUTH_TOKEN: SENTRY_TOKEN,
  SENTRY_ORG: 'example-org',
  SENTRY_PROJECT: 'example-project',
};

export const foldersOf = (
  env: DeployEnvironment,
  overrides: Readonly<Record<string, readonly SecretEntry[] | undefined>> = {},
): Record<string, readonly SecretEntry[]> =>
  Object.fromEntries(
    Object.entries({
      [folderKeyOf(env, '/ci/cloudflare')]: CLOUDFLARE_FOLDER,
      [folderKeyOf(env, '/')]: SHARED_FOLDER,
      [folderKeyOf(env, '/workers/api')]: API_FOLDER,
      [folderKeyOf(env, '/workers/event')]: EVENT_FOLDER,
      ...overrides,
    }).filter(
      (entry): entry is [string, readonly SecretEntry[]] =>
        entry[1] !== undefined,
    ),
  );

export const WORKER_SECRET_VALUES: readonly string[] = [
  ...SHARED_FOLDER,
  ...API_FOLDER,
  ...EVENT_FOLDER,
].flatMap(({ value }) => value.split('\n'));

export const ALL_SECRET_VALUES: readonly string[] = [
  CLOUDFLARE_TOKEN,
  SENTRY_TOKEN,
  ...WORKER_SECRET_VALUES,
];

const REQUIRED_SECRETS: Readonly<Record<WorkerKey, readonly string[]>> = {
  api: ['HASH_PEPPER', 'SENTRY_DSN', 'STRIPE_API_KEY'],
  event: ['HASH_PEPPER', 'PRIVATE_KEY', 'STRIPE_API_KEY'],
  client: ['HASH_PEPPER', 'SENTRY_DSN'],
  admin: ['HASH_PEPPER'],
};

export const EXPECTED_SECRETS: Readonly<
  Record<WorkerKey, Readonly<Record<string, string>>>
> = {
  api: {
    HASH_PEPPER: 'fake-shared-pepper',
    SENTRY_DSN: 'fake-api-sentry-dsn',
    STRIPE_API_KEY: 'fake-api-stripe-key',
  },
  event: {
    HASH_PEPPER: 'fake-shared-pepper',
    PRIVATE_KEY: 'fake-key-line-1\nfake-key-line-2',
    STRIPE_API_KEY: 'fake-event-stripe-key',
    EMAIL_SMOKE_TOKEN: 'fake-event-smoke-token',
  },
  client: {
    HASH_PEPPER: 'fake-shared-pepper',
    SENTRY_DSN: 'fake-shared-sentry-dsn',
  },
  admin: { HASH_PEPPER: 'fake-shared-pepper' },
};

const wranglerJsoncOf = (
  worker: WorkerKey,
  required: readonly string[] = REQUIRED_SECRETS[worker],
): string => {
  const section = JSON.stringify({ secrets: { required } });
  return `{
  "name": "app-${worker}",
  // ローカルの必須のシークレットは環境ごとの節に引き継がれない
  "secrets": { "required": ["LOCAL_ONLY_SECRET"] },
  "env": { "staging": ${section}, "prod": ${section} },
}
`;
};

export const textsOf = (
  required: Partial<Record<WorkerKey, readonly string[]>> = {},
): Record<string, string> => ({
  ...infisicalRepoTexts(),
  ...Object.fromEntries(
    WORKER_KEYS.map((worker) => [
      `apps/${worker}/wrangler.jsonc`,
      wranglerJsoncOf(worker, required[worker]),
    ]),
  ),
});

export const PREVIOUS_SHA = '89abcdef0123456789abcdef0123456789abcdef';
export const CLIENT_VERSION_ID = '00000000-0000-4000-8000-000000000001';

export const statusStdoutOf = (
  versions: readonly {
    readonly version_id: string;
    readonly percentage: number;
  }[],
): string =>
  `${JSON.stringify(
    {
      id: '00000000-0000-4000-8000-000000000002',
      created_on: '2026-10-29T00:00:00.000000Z',
      source: 'wrangler',
      strategy: 'percentage',
      author_email: 'ci@launch.example',
      versions,
    },
    null,
    2,
  )}\n`;

const STATUS_STDOUT = statusStdoutOf([
  { version_id: CLIENT_VERSION_ID, percentage: 100 },
]);

export const viewStdoutOf = (
  annotations: Readonly<Record<string, string>>,
): string =>
  `${JSON.stringify(
    {
      id: CLIENT_VERSION_ID,
      number: 3,
      metadata: { created_on: '2026-10-29T00:00:00.000000Z' },
      annotations,
    },
    null,
    2,
  )}\n`;

const VIEW_STDOUT = viewStdoutOf({
  'workers/tag': PREVIOUS_SHA,
  'workers/message': `${PREVIOUS_SHA} ${RUN_URL}`,
});

export type Step =
  | 'build'
  | 'bundle'
  | 'inject'
  | 'upload'
  | 'remove-maps'
  | 'deploy'
  | 'status'
  | 'view'
  | 'git'
  | 'allowlist';

export const stepOf = (spec: CommandSpec): Step | undefined => {
  if (spec.command === 'git') return 'git';
  if (spec.command === 'find') return 'remove-maps';
  const line = spec.args.join(' ');
  if (line === 'run build') return 'build';
  if (line.includes('sentry-cli sourcemaps inject')) return 'inject';
  if (line.includes('sentry-cli sourcemaps upload')) return 'upload';
  if (line.startsWith('run graphql:allowlist')) return 'allowlist';
  if (line.startsWith('x wrangler deploy --dry-run')) return 'bundle';
  if (line.startsWith('x wrangler deployments status')) return 'status';
  if (line.startsWith('x wrangler versions view')) return 'view';
  return spec.args.includes('deploy') ? 'deploy' : undefined;
};

export interface RunOptions {
  readonly env?: Readonly<Record<string, string>>;
  readonly folders?: Readonly<Record<string, readonly SecretEntry[]>>;
  readonly texts?: Readonly<Record<string, string>>;
  readonly failAt?: Step;
  readonly deployStdout?: string;
  readonly statusStdout?: string;
  readonly viewStdout?: string;
}

export const runWith = async (
  args: readonly string[],
  {
    env = GITHUB_ENV,
    folders = foldersOf('staging'),
    texts = textsOf(),
    failAt,
    deployStdout = DEPLOY_STDOUT,
    statusStdout = STATUS_STDOUT,
    viewStdout = VIEW_STDOUT,
  }: RunOptions = {},
) => {
  const timeline: string[] = [];
  const calls: CommandSpec[] = [];
  const stdoutOf: Partial<Record<Step, string>> = {
    deploy: deployStdout,
    status: statusStdout,
    view: viewStdout,
  };
  const runner: CommandRunner = {
    run: (spec) => {
      calls.push(spec);
      timeline.push(`run:${commandLineOf(spec)}`);
      const step = stepOf(spec);
      const failed = failAt !== undefined && step === failAt;
      return Promise.resolve({
        code: failed ? 1 : 0,
        stdout: failed || step === undefined ? '' : (stdoutOf[step] ?? ''),
        stderr: failed ? `✘ [ERROR] ${failAt}の失敗の診断\n` : '',
      });
    },
    start: () => {
      throw new Error('常駐の起動は使わない');
    },
  };
  const fake = createFakeDeps(createFakeRepoFiles(texts));
  const code = await command.run(args, {
    ...fake.deps,
    env,
    runner,
    github: createRecordingGithub(timeline),
    secrets: createFakeSecretSource({ timeline, folders }),
  });
  const summaries = timeline
    .filter((event) => event.startsWith('summary:'))
    .map((event) => event.slice('summary:'.length));
  const shown = [fake.stdout.text(), fake.stderr.text(), ...summaries].join(
    '\n',
  );
  return { ...fake, code, timeline, calls, shown, summaries };
};

export const exportOf = (env: DeployEnvironment, folder: string): string =>
  `export:${PROJECT_ID}:${env}:${folder}:${CATALOG_HOST}`;

export const BUNDLE_OUTDIR = '.wrangler/sourcemaps';
export const BUNDLED_SCRIPT_ARGS: readonly string[] = [
  `${BUNDLE_OUTDIR}/index.js`,
  '--no-bundle',
];

export const bundleLineOf = (env: DeployEnvironment): string =>
  `bun x wrangler deploy --dry-run --env ${env} --outdir ${BUNDLE_OUTDIR}`;

export const deployArgsOf = (
  envArgs: readonly string[],
  scriptArgs: readonly string[] = [],
): readonly string[] => [
  'x',
  'wrangler',
  'deploy',
  ...scriptArgs,
  ...envArgs,
  '--tag',
  SHA,
  '--message',
  `${SHA} ${RUN_URL}`,
  '--secrets-file',
  '/dev/stdin',
];

export const bundledDeployLineOf = (env: DeployEnvironment): string =>
  ['bun', ...deployArgsOf(['--env', env], BUNDLED_SCRIPT_ARGS)].join(' ');

export const removeMapsLineOf = (app: 'client' | 'admin'): string =>
  `find apps/${app}/dist/client -type f -name *.map -delete`;

export const injectLineOf = (artifactDir: string): string =>
  `bun x --no-install sentry-cli sourcemaps inject ${artifactDir}`;

export const uploadLineOf = (artifactDir: string): string =>
  `bun x --no-install sentry-cli sourcemaps upload ${artifactDir}`;

export const shownSecretsOf = (shown: string): readonly string[] =>
  ALL_SECRET_VALUES.filter((value) => shown.includes(value));

export const secretsVisibleInArgsOf = (
  calls: readonly CommandSpec[],
): readonly string[] =>
  calls.flatMap((spec) => {
    const visible = [
      ...spec.args,
      ...Object.entries(spec.env ?? {})
        .filter(([key]) => key !== 'CLOUDFLARE_API_TOKEN')
        .filter(([key]) => !(key in SENTRY_CLI_ENV))
        .flat(),
    ].join('\n');
    return WORKER_SECRET_VALUES.filter((value) => visible.includes(value));
  });

export const maskedBefore = (
  timeline: readonly string[],
  index: number,
): readonly string[] =>
  timeline
    .slice(0, index)
    .filter((event) => event.startsWith('mask:'))
    .map((event) => event.slice('mask:'.length));
