import type { CommandResult, CommandSpec } from '../adapters/command-runner.ts';
import {
  RELEASE_BASE,
  commitLinesOf,
  existingPullRequestUrlOf,
  releasePrBody,
  releasePrTitle,
  validateReleaseHead,
} from '../core/release-pr.ts';
import {
  type DeliveryCommand,
  type DeliveryDeps,
  EXIT_FAILURE,
  EXIT_SUCCESS,
} from './shared/delivery-command.ts';
import { parseOptions } from './shared/parse-options.ts';

const NAME = 'release-pr';
const TITLE = 'リリースのPR';
const HEAD_ENV_KEY = 'RELEASE_HEAD';
const RUN_ENV_KEYS = [
  'GITHUB_TOKEN',
  'GITHUB_SERVER_URL',
  'GITHUB_REPOSITORY',
  'GITHUB_RUN_ID',
] as const;

type RunEnvKey = (typeof RUN_ENV_KEYS)[number];

interface ReleaseContext {
  readonly head: string;
  readonly ghEnv: Readonly<Record<string, string>>;
  readonly runUrl: string;
  readonly compareUrl: string;
}

const fail = (deps: DeliveryDeps, message: string): number => {
  deps.stderr.write(`${NAME}: ${message}\n`);
  return EXIT_FAILURE;
};

const finish = (deps: DeliveryDeps, message: string): number => {
  deps.stdout.write(`${message}\n`);
  deps.github.summary(`${TITLE}: ${message}\n`);
  return EXIT_SUCCESS;
};

const contextOf = (deps: DeliveryDeps): ReleaseContext | string => {
  const head = validateReleaseHead(deps.env[HEAD_ENV_KEY] ?? '');
  if (!head.ok) return `環境変数${HEAD_ENV_KEY}: ${head.reason}`;
  const value = (key: RunEnvKey): string => deps.env[key] ?? '';
  const missing = RUN_ENV_KEYS.filter((key) => value(key) === '');
  if (missing.length > 0) {
    return `PRの作成に必要な環境変数がありません: ${missing.join('・')}。GitHub Actionsの中で実行してください。`;
  }
  const repositoryUrl = `${value('GITHUB_SERVER_URL')}/${value('GITHUB_REPOSITORY')}`;
  return {
    head: head.head,
    ghEnv: { GH_TOKEN: value('GITHUB_TOKEN') },
    runUrl: `${repositoryUrl}/actions/runs/${value('GITHUB_RUN_ID')}`,
    compareUrl: `${repositoryUrl}/compare/${RELEASE_BASE}...${head.head}`,
  };
};

const runCaptured = (
  deps: DeliveryDeps,
  spec: Omit<CommandSpec, 'cwd' | 'output'>,
): Promise<CommandResult> =>
  deps.runner.run({ ...spec, cwd: deps.repoRoot, output: 'capture' });

const failedRun = (
  deps: DeliveryDeps,
  { command, args }: Pick<CommandSpec, 'command' | 'args'>,
  { code, stderr }: CommandResult,
): number =>
  fail(
    deps,
    `${[command, ...args].join(' ')} が終了コード${String(code)}で失敗しました。\n${stderr}`,
  );

const findExisting = async (
  deps: DeliveryDeps,
  { head, ghEnv }: ReleaseContext,
): Promise<{ readonly url: string | undefined } | number> => {
  const spec = {
    command: 'gh',
    args: [
      'pr',
      'list',
      '--base',
      RELEASE_BASE,
      '--head',
      head,
      '--state',
      'open',
      '--json',
      'url,isCrossRepository',
    ],
    env: ghEnv,
  };
  const result = await runCaptured(deps, spec);
  if (result.code !== 0) return failedRun(deps, spec, result);
  const existing = existingPullRequestUrlOf(result.stdout);
  if (!existing.ok) {
    return fail(deps, `既存のPRの一覧を読み取れません: ${result.stdout}`);
  }
  return { url: existing.url };
};

const listCommits = async (
  deps: DeliveryDeps,
  { head }: ReleaseContext,
): Promise<readonly string[] | number> => {
  const spec = {
    command: 'git',
    args: [
      'log',
      '--oneline',
      '--no-merges',
      `origin/${RELEASE_BASE}..origin/${head}`,
    ],
  };
  const result = await runCaptured(deps, spec);
  if (result.code !== 0) return failedRun(deps, spec, result);
  return commitLinesOf(result.stdout);
};

const createPullRequest = async (
  deps: DeliveryDeps,
  { head, ghEnv, runUrl, compareUrl }: ReleaseContext,
  commits: readonly string[],
): Promise<number> => {
  const spec = {
    command: 'gh',
    args: [
      'pr',
      'create',
      '--base',
      RELEASE_BASE,
      '--head',
      head,
      '--title',
      releasePrTitle(head),
      '--body-file',
      '-',
    ],
    env: ghEnv,
    stdin: releasePrBody(head, commits, runUrl, compareUrl),
  };
  const result = await runCaptured(deps, spec);
  if (result.code !== 0) return failedRun(deps, spec, result);
  return finish(
    deps,
    `${head}から${RELEASE_BASE}へのPRを作成しました: ${result.stdout.trim()}`,
  );
};

export const command: DeliveryCommand = {
  name: NAME,
  description:
    '環境変数RELEASE_HEAD(mainかhotfix/<名前>)からprodへのリリースのPRを、既存のPRと差分のコミットを確かめてから作る',
  run: async (args, deps) => {
    parseOptions(args, { names: [], rest: 'none' });
    const context = contextOf(deps);
    if (typeof context === 'string') return fail(deps, context);
    const existing = await findExisting(deps, context);
    if (typeof existing === 'number') return existing;
    if (existing.url !== undefined) {
      return finish(
        deps,
        `${context.head}から${RELEASE_BASE}へのPRは既にあるため作成しません: ${existing.url}`,
      );
    }
    const commits = await listCommits(deps, context);
    if (typeof commits === 'number') return commits;
    if (commits.length === 0) {
      return finish(
        deps,
        `${context.head}に${RELEASE_BASE}へ反映していないコミットがありません。PRは作成しません。`,
      );
    }
    return createPullRequest(deps, context, commits);
  },
};
