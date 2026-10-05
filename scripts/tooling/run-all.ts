import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { APPS, type AppName } from '../../config/workspace-layout.ts';

export type AggregateTask =
  'lint' | 'typecheck' | 'test:unit' | 'test:browser' | 'test:worker';

export type AggregateCommand = 'check' | AggregateTask;

export type RunTarget = 'root' | AppName;

export type SkipReason = 'project-missing' | 'script-missing';

export type FailureReason = 'package-json-unreadable' | 'command-unrunnable';

export interface FailureCause {
  readonly reason: FailureReason;
  readonly detail: string;
}

export type StepOutcome =
  | { readonly status: 'passed' }
  | {
      readonly status: 'failed';
      readonly exitCode: number;
      readonly cause?: FailureCause;
    }
  | { readonly status: 'skipped'; readonly reason: SkipReason };

export interface StepResult {
  readonly step: string;
  readonly target: RunTarget;
  readonly outcome: StepOutcome;
}

export interface CommandRunner {
  run(command: readonly string[], cwd: string): Promise<number>;
}

export type PackageScriptsReader = (
  dir: string,
) => Readonly<Record<string, string>> | undefined;

export interface AggregateDependencies {
  readonly runner: CommandRunner;
  readonly readPackageScripts: PackageScriptsReader;
  readonly repoRoot: string;
}

interface TextOutput {
  readonly write: (text: string) => unknown;
}

export interface AggregateEntryDependencies extends AggregateDependencies {
  readonly args: readonly string[];
  readonly stdout: TextOutput;
  readonly stderr: TextOutput;
}

interface TargetDir {
  readonly target: RunTarget;
  readonly dir: string;
}

interface PlannedStep {
  readonly script: string;
  readonly targets: readonly TargetDir[];
  readonly args: readonly string[];
}

const AGGREGATE_COMMANDS: readonly AggregateCommand[] = [
  'check',
  'lint',
  'typecheck',
  'test:unit',
  'test:browser',
  'test:worker',
];

const ROOT_ONLY: readonly TargetDir[] = [{ target: 'root', dir: '.' }];

const ROOT_AND_APPS: readonly TargetDir[] = [
  ...ROOT_ONLY,
  ...APPS.map(({ name, dir }) => ({ target: name, dir })),
];

// 配置の不備は後段の静的解析・型検査で依存の解決エラーとして現れるため、最初に確認して原因を先に表示する
const CHECK_STEPS: readonly PlannedStep[] = [
  { script: 'shared-dirs:verify', targets: ROOT_ONLY, args: [] },
  { script: 'check:test-names', targets: ROOT_ONLY, args: [] },
  { script: 'format:check', targets: ROOT_ONLY, args: [] },
  { script: 'lint', targets: ROOT_AND_APPS, args: [] },
  { script: 'typecheck', targets: ROOT_AND_APPS, args: [] },
];

const STEP_LABELS: ReadonlyMap<string, string> = new Map([
  ['shared-dirs:verify', '共有ディレクトリの配置確認'],
  ['check:test-names', 'テスト命名の検査'],
  ['format:check', '整形検査'],
  ['lint', '静的解析'],
  ['typecheck', '型検査'],
  ['test:unit', '単体テスト'],
  ['test:browser', 'ブラウザテスト'],
  ['test:worker', 'Workers統合テスト'],
]);

const SKIP_REASON_LABELS: Readonly<Record<SkipReason, string>> = {
  'project-missing': 'プロジェクト未作成',
  'script-missing': 'スクリプト未定義',
};

const FAILURE_REASON_LABELS: Readonly<Record<FailureReason, string>> = {
  'package-json-unreadable': 'package.jsonを読めない',
  'command-unrunnable': 'コマンドを実行できない',
};

const USAGE = [
  `使い方: bun scripts/tooling/run-all.ts <${AGGREGATE_COMMANDS.join('|')}> [引数...]`,
  '  check: 共有ディレクトリの配置確認・テスト命名の検査・整形検査・静的解析・型検査を、失敗しても止めずにすべて実行する(引数は受け取らない)',
  '  それ以外: ルートと各アプリの同名スクリプトを、残りの引数付きで実行する',
  '',
].join('\n');

const planOf = (
  command: AggregateCommand,
  forwardedArgs: readonly string[],
): readonly PlannedStep[] =>
  command === 'check'
    ? CHECK_STEPS
    : [{ script: command, targets: ROOT_AND_APPS, args: forwardedArgs }];

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const failedBecause = (reason: FailureReason, detail: string): StepOutcome => ({
  status: 'failed',
  exitCode: 1,
  cause: { reason, detail },
});

const dirLabelOf = (dir: string): string => (dir === '.' ? 'ルート' : dir);

// 1つの対象の不備で一括実行全体を止めず、その対象の失敗として原因と共に記録して他の対象を続ける
const outcomeWithoutRunning = (
  script: string,
  dir: string,
  cwd: string,
  readScripts: PackageScriptsReader,
): StepOutcome | undefined => {
  try {
    // package.jsonの無いディレクトリでbun runを実行すると親のルートのスクリプトが実行されてしまうため、実行前に飛ばす
    const scripts = readScripts(cwd);
    if (scripts === undefined) {
      return { status: 'skipped', reason: 'project-missing' };
    }
    return Object.hasOwn(scripts, script)
      ? undefined
      : { status: 'skipped', reason: 'script-missing' };
  } catch (error) {
    return failedBecause(
      'package-json-unreadable',
      `${join(dir, 'package.json')}を読み込めませんでした: ${messageOf(error)}`,
    );
  }
};

const runScript = async (
  command: readonly string[],
  dir: string,
  cwd: string,
  runner: CommandRunner,
): Promise<StepOutcome> => {
  try {
    const exitCode = await runner.run(command, cwd);
    return exitCode === 0
      ? { status: 'passed' }
      : { status: 'failed', exitCode };
  } catch (error) {
    return failedBecause(
      'command-unrunnable',
      `${dirLabelOf(dir)}で\`${command.join(' ')}\`を実行できませんでした: ${messageOf(error)}`,
    );
  }
};

const runStep = async (
  { script, args }: PlannedStep,
  { dir }: TargetDir,
  { runner, readPackageScripts, repoRoot }: AggregateDependencies,
): Promise<StepOutcome> => {
  const cwd = join(repoRoot, dir);
  return (
    outcomeWithoutRunning(script, dir, cwd, readPackageScripts) ??
    runScript(['bun', 'run', script, ...args], dir, cwd, runner)
  );
};

export async function runAggregate(
  command: AggregateCommand,
  forwardedArgs: readonly string[],
  deps: AggregateDependencies,
): Promise<readonly StepResult[]> {
  const results: StepResult[] = [];
  for (const step of planOf(command, forwardedArgs)) {
    for (const target of step.targets) {
      // 子プロセスの出力が混ざらないよう、1つずつ順に実行する
      const outcome = await runStep(step, target, deps);
      results.push({ step: step.script, target: target.target, outcome });
    }
  }
  return results;
}

const stepLabelOf = (step: string): string => {
  const label = STEP_LABELS.get(step);
  return label === undefined ? step : `${label}(${step})`;
};

const targetLabelOf = (target: RunTarget): string =>
  target === 'root' ? 'ルート' : target;

const outcomeLabelOf = (outcome: StepOutcome): string => {
  switch (outcome.status) {
    case 'passed':
      return '成功';
    case 'failed':
      return outcome.cause === undefined
        ? `失敗(終了コード${String(outcome.exitCode)})`
        : `失敗(${FAILURE_REASON_LABELS[outcome.cause.reason]})`;
    case 'skipped':
      return `飛ばした(${SKIP_REASON_LABELS[outcome.reason]})`;
  }
};

const padToWidth = (text: string, width: number): string =>
  `${text}${' '.repeat(width - Bun.stringWidth(text))}`;

const formatTable = (
  rows: readonly (readonly [string, string, string])[],
): string => {
  const stepWidth = Math.max(...rows.map(([step]) => Bun.stringWidth(step)));
  const targetWidth = Math.max(
    ...rows.map(([, target]) => Bun.stringWidth(target)),
  );
  return rows
    .map(
      ([step, target, outcome]) =>
        `${padToWidth(step, stepWidth)}  ${padToWidth(target, targetWidth)}  ${outcome}\n`,
    )
    .join('');
};

const countOf = (
  results: readonly StepResult[],
  status: StepOutcome['status'],
): string =>
  String(results.filter(({ outcome }) => outcome.status === status).length);

export function formatSummary(results: readonly StepResult[]): string {
  const table = formatTable([
    ['段階', '対象', '結果'],
    ...results.map(
      ({ step, target, outcome }) =>
        [
          stepLabelOf(step),
          targetLabelOf(target),
          outcomeLabelOf(outcome),
        ] as const,
    ),
  ]);
  return `${table}成功${countOf(results, 'passed')}件・失敗${countOf(results, 'failed')}件・飛ばした${countOf(results, 'skipped')}件\n`;
}

// 同じpackage.jsonは段階ごとに読み直すため、同じ原因は1度だけ示す
export function formatFailureCauses(results: readonly StepResult[]): string {
  const details = [
    ...new Set(
      results.flatMap(({ outcome }) =>
        outcome.status === 'failed' && outcome.cause !== undefined
          ? [outcome.cause.detail]
          : [],
      ),
    ),
  ];
  if (details.length === 0) return '';
  return [
    `スクリプトを実行できなかった原因が${String(details.length)}件あります。`,
    ...details.map((detail) => `  ${detail}`),
    '',
  ].join('\n');
}

export function exitCodeOf(results: readonly StepResult[]): 0 | 1 {
  return results.some(({ outcome }) => outcome.status === 'failed') ? 1 : 0;
}

const isPlainObject = (
  value: unknown,
): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isScriptMap = (
  value: unknown,
): value is Readonly<Record<string, string>> =>
  isPlainObject(value) &&
  Object.values(value).every((command) => typeof command === 'string');

export const readPackageScripts: PackageScriptsReader = (dir) => {
  const packageJsonPath = join(dir, 'package.json');
  if (!existsSync(packageJsonPath)) return undefined;
  const manifest: unknown = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  if (!isPlainObject(manifest)) {
    throw new Error('最上位の値がオブジェクトではありません');
  }
  const { scripts } = manifest;
  if (scripts === undefined) return {};
  if (!isScriptMap(scripts)) {
    throw new Error('scriptsが、値がすべて文字列のオブジェクトではありません');
  }
  return scripts;
};

export function createSpawnRunner(
  repoRoot: string,
  output: TextOutput,
): CommandRunner {
  return {
    run: (command, cwd) => {
      output.write(
        `\n▶ ${relative(repoRoot, cwd) || 'ルート'}: ${command.join(' ')}\n`,
      );
      // 違反の内容や進捗を端末へそのまま流すため、子プロセスに標準入出力を引き継ぐ
      return Bun.spawn([...command], {
        cwd,
        stdio: ['inherit', 'inherit', 'inherit'],
      }).exited;
    },
  };
}

interface ParsedArgs {
  readonly command: AggregateCommand;
  readonly forwardedArgs: readonly string[];
}

const isAggregateCommand = (value: string): value is AggregateCommand =>
  (AGGREGATE_COMMANDS as readonly string[]).includes(value);

// checkの各段階は引数の意味が異なり、配置確認のように余分な引数で失敗する段階もあるため、引数を受け取らない
const parseArgs = (args: readonly string[]): ParsedArgs | undefined => {
  const [command, ...forwardedArgs] = args;
  if (command === undefined || !isAggregateCommand(command)) return undefined;
  if (command === 'check' && forwardedArgs.length > 0) return undefined;
  return { command, forwardedArgs };
};

export async function runAggregateEntry({
  args,
  stdout,
  stderr,
  ...deps
}: AggregateEntryDependencies): Promise<number> {
  const parsed = parseArgs(args);
  if (parsed === undefined) {
    stderr.write(USAGE);
    return 1;
  }
  try {
    const results = await runAggregate(
      parsed.command,
      parsed.forwardedArgs,
      deps,
    );
    stdout.write(`\n${formatSummary(results)}`);
    const causes = formatFailureCauses(results);
    if (causes !== '') stderr.write(causes);
    return exitCodeOf(results);
  } catch (error) {
    stderr.write(`一括実行を完了できませんでした: ${messageOf(error)}\n`);
    return 1;
  }
}

if (import.meta.main) {
  // サブディレクトリで実行してもルートと全アプリを対象にするため、カレントディレクトリではなくこのスクリプトを含むリポジトリを対象にする
  const repoRoot = resolve(import.meta.dirname, '..', '..');
  process.exitCode = await runAggregateEntry({
    args: process.argv.slice(2),
    repoRoot,
    runner: createSpawnRunner(repoRoot, process.stdout),
    readPackageScripts,
    stdout: process.stdout,
    stderr: process.stderr,
  });
}
