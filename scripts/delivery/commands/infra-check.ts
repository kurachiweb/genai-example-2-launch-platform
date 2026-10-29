import type { RepoFiles } from '../adapters/repo-files.ts';
import {
  INFRA_CONFIG_PATTERNS,
  INFRA_TEST_PATTERNS,
  type InfraCheckStep,
  planInfraCheck,
} from '../core/infra-check-plan.ts';
import {
  type DeliveryCommand,
  type DeliveryDeps,
  EXIT_FAILURE,
  EXIT_SUCCESS,
  UsageError,
} from './shared/delivery-command.ts';

const TITLE = 'IaCの検査';

const listAll = async (
  files: RepoFiles,
  patterns: readonly string[],
): Promise<readonly string[]> =>
  (await Promise.all(patterns.map((pattern) => files.list(pattern)))).flat();

const lineOf = ({ command, args }: InfraCheckStep): string =>
  [command, ...args].join(' ');

const runSteps = async (
  steps: readonly InfraCheckStep[],
  { runner, repoRoot, stdout, stderr }: DeliveryDeps,
): Promise<number> => {
  for (const step of steps) {
    const line = lineOf(step);
    stdout.write(`$ ${line}\n`);
    // 子プロセスの出力が混ざらず、最初の失敗で後続を実行しないよう、1つずつ順に実行する
    const { code } = await runner.run({
      command: step.command,
      args: step.args,
      cwd: repoRoot,
      output: 'inherit',
    });
    if (code !== 0) {
      stderr.write(
        `${TITLE}: ${line} が終了コード${String(code)}で失敗しました。\n`,
      );
      return EXIT_FAILURE;
    }
  }
  stdout.write(`${TITLE}: すべて成功しました。\n`);
  return EXIT_SUCCESS;
};

export const command: DeliveryCommand = {
  name: 'infra-check',
  description: 'IaC定義の整形・初期化・妥当性・テストを検査する',
  run: async (args, deps) => {
    if (args.length > 0) {
      throw new UsageError(`引数は受け取りません: ${args.join(' ')}`);
    }
    const [configFiles, testFiles] = await Promise.all([
      listAll(deps.files, INFRA_CONFIG_PATTERNS),
      listAll(deps.files, INFRA_TEST_PATTERNS),
    ]);
    return runSteps(planInfraCheck({ configFiles, testFiles }), deps);
  },
};
