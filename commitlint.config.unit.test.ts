import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RuleConfigSeverity } from '@commitlint/types';

import config, { ALLOWED_COMMIT_TYPES } from './commitlint.config.ts';

const ROOT = import.meta.dirname;
const CONFIG_PATH = join(ROOT, 'commitlint.config.ts');
const COMMITLINT_BIN = join(ROOT, 'node_modules/.bin/commitlint');
const GIT_WORKFLOW_RULE_PATH = join(
  ROOT,
  '.claude/rules/common/git-workflow.md',
);
const SPAWN_TIMEOUT_MS = 30_000;
const REVERTED_COMMIT_SHA = '0123456789abcdef0123456789abcdef01234567';

let workDir = '';

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'commitlint-config-test-'));
});

afterAll(async () => {
  if (workDir !== '') {
    await rm(workDir, { recursive: true, force: true });
  }
});

interface LintResult {
  readonly exitCode: number;
  readonly output: string;
}

// Gitの管理外の一時ディレクトリから環境変数を渡さずに起動し、検査がリポジトリのGit設定やフックに触れないようにする
const lintMessage = async (message: string): Promise<LintResult> => {
  const child = Bun.spawn(
    [process.execPath, '--bun', COMMITLINT_BIN, '--config', CONFIG_PATH],
    {
      cwd: workDir,
      env: {},
      stdin: new Blob([message]),
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, output: `${stdout}\n${stderr}` };
};

const commitTypesOfGitWorkflowRule = async (): Promise<readonly string[]> => {
  const rule = await readFile(GIT_WORKFLOW_RULE_PATH, 'utf8');
  const typesLine = /^Types: (.+)$/m.exec(rule)?.[1] ?? '';
  return typesLine.split(',').map((type) => type.trim());
};

const ALLOWED_COMMIT_TYPE_LIST = ALLOWED_COMMIT_TYPES.join(', ');
const COMMIT_HEADER_FORMAT = '型(任意のスコープ): 件名';

const expectAccepted = async (message: string): Promise<void> => {
  const { exitCode, output } = await lintMessage(message);

  expect(exitCode).toBe(0);
  expect(output).not.toContain(COMMIT_HEADER_FORMAT);
  expect(output).not.toContain(ALLOWED_COMMIT_TYPE_LIST);
};

describe('commitlint.config.ts', () => {
  test('許可する型の一覧は開発者向けGit規約の一覧と一致する', async () => {
    expect<readonly string[]>(ALLOWED_COMMIT_TYPES).toEqual(
      await commitTypesOfGitWorkflowRule(),
    );
  });

  test('型が空でないこと・件名が空でないこと・型が一覧に含まれることの3規則と違反時の案内文だけを持ち、他の設定を継承しない', () => {
    const { helpUrl, ...rest } = config;

    expect(rest).toEqual({
      rules: {
        'type-empty': [RuleConfigSeverity.Error, 'never'],
        'subject-empty': [RuleConfigSeverity.Error, 'never'],
        'type-enum': [RuleConfigSeverity.Error, 'always', ALLOWED_COMMIT_TYPES],
      },
    });
    expect(helpUrl).toContain(COMMIT_HEADER_FORMAT);
    expect(helpUrl).toContain(ALLOWED_COMMIT_TYPE_LIST);
  });
});

describe('コミットメッセージの検査', () => {
  test.each([
    ['型が一覧に無い', 'update: 何かを更新する', 'type-enum'],
    ['件名が空の', 'feat: ', 'subject-empty'],
    ['型が無い', '型の無いメッセージ', 'type-empty'],
  ])(
    '%sメッセージを、違反した規則と書式と許可された型の一覧を表示して拒否する',
    async (_, message, violatedRule) => {
      const { exitCode, output } = await lintMessage(message);

      expect(exitCode).toBe(1);
      expect(output).toContain(`[${violatedRule}]`);
      expect(output).toContain(ALLOWED_COMMIT_TYPE_LIST);
      expect(output).toContain(COMMIT_HEADER_FORMAT);
    },
    SPAWN_TIMEOUT_MS,
  );

  test.each(ALLOWED_COMMIT_TYPES.map((type) => [type]))(
    '型が%sのメッセージを案内を表示せずに受け入れる',
    async (type) => {
      await expectAccepted(`${type}: 件名`);
    },
    SPAWN_TIMEOUT_MS,
  );

  test.each([
    ['日本語のスコープ', 'feat(認証): ログイン画面を作る'],
    ['スコープ無しで日本語の件名', 'docs: 日本語の件名'],
    ['英字のスコープ', 'ci(dev-tooling): 型の検査をCIでも実行する'],
    [
      '大文字と記号を含むスコープと件名',
      'refactor(API_v2/Auth): Rename The Handler.',
    ],
    ['120文字を超える件名', `fix: ${'長い件名の修正'.repeat(20)}`],
    [
      '本文に長い行',
      `feat: 本文の長いコミット\n\n${'本文の長い行'.repeat(50)}\n`,
    ],
  ])(
    '%sを含むメッセージを案内を表示せずに受け入れる',
    async (_, message) => {
      await expectAccepted(message);
    },
    SPAWN_TIMEOUT_MS,
  );

  test.each([
    ['ブランチのマージ', "Merge branch 'feature'\n"],
    ['取り込み先付きのブランチのマージ', "Merge branch 'feature' into main\n"],
    [
      'リバート',
      `Revert "feat: ログイン画面を作る"\n\nThis reverts commit ${REVERTED_COMMIT_SHA}.\n`,
    ],
  ])(
    'Gitが自動生成した%sのメッセージを型を検査せずに受け入れる',
    async (_, message) => {
      await expectAccepted(message);
    },
    SPAWN_TIMEOUT_MS,
  );
});
