import type {
  CommandResult,
  CommandSpec,
} from '../../adapters/command-runner.ts';
import type { DeployEnvironment } from '../../catalog/resource-catalog.ts';
import { type DeliveryDeps, EXIT_FAILURE } from './delivery-command.ts';
import { openInfisicalFolders } from './infisical-folders.ts';
import type { InfisicalTarget } from './infisical-target.ts';

export const TOFU = 'tofu';
export const LIVE_DIR_ARG = '-chdir=apps/infra/live';
export const TOFU_SECRET_FOLDER = '/ci/tofu';
export const TOFU_STATE_SECRET_KEYS: readonly string[] = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'TF_VAR_state_passphrase',
];

const TITLE = 'OpenTofuの実行';

export interface TofuSession {
  readonly env: DeployEnvironment;
  readonly target: InfisicalTarget;
  readonly stateEnv: Readonly<Record<string, string>>;
}

export type TofuStep = Omit<CommandSpec, 'command' | 'cwd'>;

const writeError = (
  name: string,
  message: string,
  deps: DeliveryDeps,
): void => {
  deps.stderr.write(`${name}: ${message}\n`);
};

// /ci/tofuの値(stateの保管先の鍵と暗号化のパスフレーズ)をマスクしてから、子プロセスの環境変数として使える形で返す
export async function openTofuSession(
  name: string,
  env: DeployEnvironment,
  deps: DeliveryDeps,
): Promise<TofuSession | number> {
  const opened = await openInfisicalFolders(
    name,
    TITLE,
    env,
    [TOFU_SECRET_FOLDER],
    deps,
  );
  if (typeof opened === 'number') return opened;
  const [entries = []] = opened.folders;
  const present = new Set(entries.map(({ key }) => key));
  const missing = TOFU_STATE_SECRET_KEYS.filter((key) => !present.has(key));
  if (missing.length > 0) {
    writeError(
      name,
      `Infisicalの${opened.target.environment}のフォルダ${TOFU_SECRET_FOLDER}にキーがありません: ${missing.join('・')}`,
      deps,
    );
    return EXIT_FAILURE;
  }
  return {
    env,
    target: opened.target,
    stateEnv: Object.fromEntries(entries.map(({ key, value }) => [key, value])),
  };
}

export const tofuLineOf = (args: readonly string[]): string =>
  [TOFU, LIVE_DIR_ARG, ...args].join(' ');

// OpenTofuは誤りの診断を標準エラー出力へ、計画の本文と警告を標準出力へ出すため、失敗した時だけ取り込んだ標準エラー出力を表示する
export async function runTofuStep(
  name: string,
  step: TofuStep,
  deps: DeliveryDeps,
): Promise<CommandResult | undefined> {
  const line = tofuLineOf(step.args);
  deps.stdout.write(`$ ${line}\n`);
  const result = await deps.runner.run({
    ...step,
    command: TOFU,
    args: [LIVE_DIR_ARG, ...step.args],
    cwd: deps.repoRoot,
  });
  if (result.code === 0) return result;
  if (step.output !== 'inherit' && result.stderr !== '') {
    deps.stderr.write(
      result.stderr.endsWith('\n') ? result.stderr : `${result.stderr}\n`,
    );
  }
  writeError(
    name,
    `${line} が終了コード${String(result.code)}で失敗しました。`,
    deps,
  );
  return undefined;
}

export const initTofu = (
  name: string,
  session: TofuSession,
  deps: DeliveryDeps,
): Promise<CommandResult | undefined> =>
  runTofuStep(
    name,
    {
      args: [
        'init',
        '-input=false',
        '-reconfigure',
        `-backend-config=../backends/${session.env}.s3.hcl`,
      ],
      env: session.stateEnv,
      output: 'inherit',
    },
    deps,
  );
