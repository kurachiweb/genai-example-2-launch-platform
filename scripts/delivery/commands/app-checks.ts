import type { RepoFiles } from '../adapters/repo-files.ts';
import {
  type AppCheckStep,
  appCheckDirs,
  appPackageJsonOf,
  planAppChecks,
  scriptNamesOf,
} from '../core/app-checks.ts';
import {
  type DeliveryCommand,
  type DeliveryDeps,
  EXIT_FAILURE,
  EXIT_SUCCESS,
  UsageError,
} from './shared/delivery-command.ts';
import {
  runInTarget,
  stepLineOf,
  type TargetStep,
  targetLabelOf,
} from './shared/install-targets.ts';
import {
  allLoaded,
  type Loaded,
  loaded,
  parseInput,
  readInput,
} from './shared/load-input.ts';
import { reportInputErrors } from './shared/report-violations.ts';

const TITLE = '生成物と設定の検査';

type DirScripts = readonly [dir: string, scripts: readonly string[]];

const loadScripts = async (
  files: RepoFiles,
  dir: string,
): Promise<Loaded<DirScripts>> => {
  const path = appPackageJsonOf(dir);
  const text = await readInput(files, path);
  if (!text.ok) return text;
  const json = parseInput(path, text.value, 'JSON', JSON.parse);
  if (!json.ok) return json;
  return loaded([dir, scriptNamesOf(json.value)]);
};

const scriptStepOf = ({ script }: AppCheckStep): TargetStep => ({
  args: ['run', script],
});

const runChecks = async (
  steps: readonly AppCheckStep[],
  deps: DeliveryDeps,
): Promise<number> => {
  for (const check of steps) {
    const step = scriptStepOf(check);
    // 子プロセスの出力が混ざらず、最初の失敗で後続を実行しないよう、1つずつ順に実行する
    const code = await runInTarget(check.dir, step, deps);
    if (code !== 0) {
      deps.stderr.write(
        `${TITLE}: ${targetLabelOf(check.dir)}の${stepLineOf(step)}が終了コード${String(code)}で失敗しました。\n`,
      );
      return EXIT_FAILURE;
    }
  }
  deps.stdout.write(
    `${TITLE}: ${String(steps.length)}件すべて成功しました。\n`,
  );
  return EXIT_SUCCESS;
};

export const command: DeliveryCommand = {
  name: 'app-checks',
  description:
    'アプリごとの生成物と設定の検査(マイグレーションの検出・DIのスモークテスト)を順に実行する',
  run: async (args, deps) => {
    if (args.length > 0) {
      throw new UsageError(`引数は受け取りません: ${args.join(' ')}`);
    }
    const scripts = allLoaded(
      await Promise.all(
        appCheckDirs().map((dir) => loadScripts(deps.files, dir)),
      ),
    );
    if (!scripts.ok) return reportInputErrors(TITLE, scripts.errors, deps);
    const plan = planAppChecks(new Map(scripts.value));
    if (!plan.ok) return reportInputErrors(TITLE, plan.errors, deps);
    return runChecks(plan.steps, deps);
  },
};
