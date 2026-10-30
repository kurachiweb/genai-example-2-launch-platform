import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEPLOY_ENVIRONMENTS,
  type DeployEnvironment,
  WORKER_KEYS,
  type WorkerKey,
} from '../catalog/resource-catalog.ts';
import { VITE_BUILT_WORKERS, appDirOf } from '../core/worker-apps.ts';
import {
  type DeliveryCommand,
  type DeliveryDeps,
  EXIT_FAILURE,
  EXIT_SUCCESS,
} from './shared/delivery-command.ts';
import {
  runInTarget,
  stepLineOf,
  type TargetStep,
  targetLabelOf,
} from './shared/install-targets.ts';
import { parseOptions, requiredChoice } from './shared/parse-options.ts';

const NAME = 'rehearse';
const OUTDIR_NAME = 'rehearsal';

interface RehearsalStep {
  readonly dir: string;
  readonly step: TargetStep;
}

const nonEmpty = (value: string | undefined): string | undefined =>
  value === undefined || value === '' ? undefined : value;

const dryRunOf = (envArgs: readonly string[], outdir: string): TargetStep => ({
  args: [
    'x',
    'wrangler',
    'deploy',
    '--dry-run',
    ...envArgs,
    '--outdir',
    outdir,
  ],
});

const stepsOf = (
  app: WorkerKey,
  env: DeployEnvironment,
  tempDir: string,
): readonly RehearsalStep[] => {
  const dir = appDirOf(app);
  const outdir = join(tempDir, OUTDIR_NAME, env, app);
  if (!VITE_BUILT_WORKERS.has(app)) {
    return [{ dir, step: dryRunOf(['--env', env], outdir) }];
  }
  return [
    { dir, step: { args: ['run', 'build'], env: { CLOUDFLARE_ENV: env } } },
    { dir, step: dryRunOf([], outdir) },
  ];
};

const rehearse = async (
  env: DeployEnvironment,
  deps: DeliveryDeps,
): Promise<number> => {
  const title = `${env}のデプロイの予行`;
  const tempDir = nonEmpty(deps.env.RUNNER_TEMP) ?? tmpdir();
  const steps = WORKER_KEYS.flatMap((app) => stepsOf(app, env, tempDir));
  for (const { dir, step } of steps) {
    // 子プロセスの出力が混ざらず、最初の失敗で後続を実行しないよう、1つずつ順に実行する
    const code = await runInTarget(dir, step, deps);
    if (code !== 0) {
      deps.stderr.write(
        `${title}: ${targetLabelOf(dir)}の${stepLineOf(step)}が終了コード${String(code)}で失敗しました。\n`,
      );
      return EXIT_FAILURE;
    }
  }
  deps.stdout.write(
    `${title}: ${String(WORKER_KEYS.length)}件のWorkerすべて成功しました。\n`,
  );
  return EXIT_SUCCESS;
};

export const command: DeliveryCommand = {
  name: NAME,
  description:
    '指定した環境(staging・prod)の各Workerを、秘密値を使わず資源を作らないデプロイのdry-runで予行する(client・adminは環境を指定してビルドしてから)',
  run: async (args, deps) => {
    const { options } = parseOptions(args, { names: ['env'], rest: 'none' });
    const env = requiredChoice(options, 'env', DEPLOY_ENVIRONMENTS);
    return rehearse(env, deps);
  },
};
