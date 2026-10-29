import { type AppName, APPS } from '../../../config/workspace-layout.ts';

export type E2eStackServiceName = 'mailpit' | 'api' | 'event';
export type E2eStackWorker = Extract<AppName, 'api' | 'event'>;

export interface E2eStackStep {
  readonly dir: string;
  readonly command: string;
  readonly args: readonly string[];
}

export interface E2eStackWait {
  readonly url: string;
  readonly expectStatus: number | 'any';
}

export interface E2eStackService extends E2eStackStep {
  readonly name: E2eStackServiceName;
  readonly wait: E2eStackWait;
  readonly logFile: string;
}

export interface E2eStackPlanInput {
  readonly cliPath: string;
  readonly mailpitBin: string;
  readonly logDir: string;
}

export interface E2eStackPlan {
  readonly prepare: E2eStackStep;
  readonly services: readonly E2eStackService[];
}

interface ServiceDefinition {
  readonly name: E2eStackServiceName;
  readonly port: number;
  readonly waitPath: string;
  readonly expectStatus: E2eStackWait['expectStatus'];
  readonly worker?: E2eStackWorker;
  readonly extraArgs?: readonly string[];
}

const LISTEN_HOST = '127.0.0.1';
const ROOT_DIR = '.';

export const LOCAL_STATE_DIR = '/workspace/.wrangler/state';
export const E2E_STACK_WAIT_TIMEOUT_MS = 180_000;
export const E2E_STACK_LOG_TAIL_LINES = 50;

const E2E_LOG_DIR_NAME = 'e2e-logs';
const SECRETS_SCOPE = 'checks';

// client・adminはテストのコマンド(test:e2e:dev-and-preview)が開発サーバーとビルド後のプレビューで起動するため含めない。wrangler devの追加の引数は各アプリのdevスクリプトにそろえる
export const E2E_STACK_SERVICES: readonly ServiceDefinition[] = [
  { name: 'mailpit', port: 48041, waitPath: '/', expectStatus: 'any' },
  {
    name: 'api',
    port: 48042,
    waitPath: '/health',
    expectStatus: 200,
    worker: 'api',
    extraArgs: ['--test-scheduled'],
  },
  {
    name: 'event',
    port: 48043,
    waitPath: '/health',
    expectStatus: 200,
    worker: 'event',
    extraArgs: ['--inspector-port', '9230'],
  },
];

const appDirOf = (app: AppName): string => {
  const found = APPS.find(({ name }) => name === app);
  if (found === undefined) {
    throw new Error(`アプリの一覧に${app}がありません。`);
  }
  return found.dir;
};

export const e2eLogDirOf = (tempDir: string): string =>
  `${tempDir.replace(/\/+$/u, '')}/${E2E_LOG_DIR_NAME}`;

const stepOf = (
  { port, worker, extraArgs = [] }: ServiceDefinition,
  { cliPath, mailpitBin }: E2eStackPlanInput,
): E2eStackStep => {
  const address = `${LISTEN_HOST}:${String(port)}`;
  if (worker === undefined) {
    return { dir: ROOT_DIR, command: mailpitBin, args: ['--listen', address] };
  }
  return {
    dir: appDirOf(worker),
    command: 'bun',
    args: [
      cliPath,
      'run-with-secrets',
      '--scope',
      SECRETS_SCOPE,
      '--worker',
      worker,
      '--',
      'bunx',
      'wrangler',
      'dev',
      '--port',
      String(port),
      '--ip',
      LISTEN_HOST,
      '--persist-to',
      LOCAL_STATE_DIR,
      ...extraArgs,
    ],
  };
};

export function planE2eStack(input: E2eStackPlanInput): E2eStackPlan {
  return {
    prepare: {
      dir: appDirOf('api'),
      command: 'bun',
      args: ['run', 'db:migrate:local'],
    },
    services: E2E_STACK_SERVICES.map((definition) => ({
      name: definition.name,
      ...stepOf(definition, input),
      wait: {
        url: `http://${LISTEN_HOST}:${String(definition.port)}${definition.waitPath}`,
        expectStatus: definition.expectStatus,
      },
      logFile: `${input.logDir}/${definition.name}.log`,
    })),
  };
}

export interface StackStartError {
  readonly service: E2eStackServiceName;
  readonly reason: string;
  readonly logFile: string;
  readonly tail: string;
}

const EMPTY_LOG = '(ログは空です)';
const MS_PER_MINUTE = 60_000;
const WAIT_MINUTES = String(E2E_STACK_WAIT_TIMEOUT_MS / MS_PER_MINUTE);

export const waitFailureReason = ({
  url,
  expectStatus,
}: E2eStackWait): string =>
  expectStatus === 'any'
    ? `${url}が${WAIT_MINUTES}分以内に応答しませんでした`
    : `${url}が${WAIT_MINUTES}分以内に${String(expectStatus)}を返しませんでした`;

export function stackStartErrorReport(
  errors: readonly StackStartError[],
): string {
  return errors
    .map(({ service, reason, logFile, tail }) => {
      const body = tail === '' ? EMPTY_LOG : tail.replace(/\n$/u, '');
      return `${service}が起動しませんでした(${reason})。ログ(${logFile})の末尾${String(E2E_STACK_LOG_TAIL_LINES)}行:\n${body}\n`;
    })
    .join('');
}
