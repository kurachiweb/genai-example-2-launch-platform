import { describe, expect, test } from 'bun:test';

import type { CommandSpec } from '../adapters/command-runner.ts';
import {
  type CommandOutputs,
  commandLineOf,
  createRecordingRunner,
} from '../test-fixtures/command-runner.ts';
import { rejectionMessageOf } from '../test-fixtures/rejection.ts';
import {
  FAKE_REPO_ROOT,
  createFakeDeps,
  createFakeRepoFiles,
} from '../test-fixtures/repo-files.ts';
import { command } from './release-pr.ts';
import {
  EXIT_FAILURE,
  EXIT_SUCCESS,
  UsageError,
} from './shared/delivery-command.ts';

const GITHUB_TOKEN = 'fake-github-token';
const RUN_URL = 'https://github.example/owner/repo/actions/runs/42';
const CREATED_URL = 'https://github.example/owner/repo/pull/8';
const EXISTING_URL = 'https://github.example/owner/repo/pull/7';
const FORK_URL = 'https://github.example/owner/repo/pull/9';
const GIT_LOG = 'abc1234 機能を追加する\ndef5678 不具合を直す\n';

const RUN_ENV = {
  GITHUB_TOKEN,
  GITHUB_SERVER_URL: 'https://github.example',
  GITHUB_REPOSITORY: 'owner/repo',
  GITHUB_RUN_ID: '42',
};

const listLineOf = (head: string): string =>
  `gh pr list --base prod --head ${head} --state open --json url,isCrossRepository`;

const listOutputOf =
  (entries: readonly unknown[]) =>
  (line: string): CommandOutputs =>
    line.startsWith('gh pr list')
      ? { stdout: JSON.stringify(entries) }
      : defaultOutputsOf(line);

const manyCommitsLog = (count: number): string =>
  Array.from(
    { length: count },
    (_, index) => `${String(index).padStart(7, '0')} 変更${String(index)}`,
  ).join('\n');

const logLineOf = (head: string): string =>
  `git log --oneline --no-merges origin/prod..origin/${head}`;

const createLineOf = (head: string): string =>
  `gh pr create --base prod --head ${head} --title リリース: ${head} → prod --body-file -`;

interface RunOptions {
  readonly env?: Readonly<Record<string, string>>;
  readonly exitCodeOf?: (line: string) => number;
  readonly outputsOf?: (line: string) => CommandOutputs;
}

const defaultOutputsOf = (line: string): CommandOutputs => {
  if (line.startsWith('gh pr list')) return { stdout: '[]\n' };
  if (line.startsWith('git log')) return { stdout: GIT_LOG };
  if (line.startsWith('gh pr create')) return { stdout: `${CREATED_URL}\n` };
  return {};
};

const runWith = async (
  args: readonly string[],
  {
    env = { ...RUN_ENV, RELEASE_HEAD: 'main' },
    exitCodeOf = () => 0,
    outputsOf = defaultOutputsOf,
  }: RunOptions = {},
) => {
  const recording = createRecordingRunner(
    (spec) => exitCodeOf(commandLineOf(spec)),
    (spec) => outputsOf(commandLineOf(spec)),
  );
  const fake = createFakeDeps(createFakeRepoFiles({}));
  const code = await command.run(args, {
    ...fake.deps,
    env,
    runner: recording.runner,
  });
  const calls = recording.calls();
  return {
    ...fake,
    code,
    calls,
    lines: calls.map(commandLineOf),
    callOf: (prefix: string): CommandSpec | undefined =>
      calls.find((spec) => commandLineOf(spec).startsWith(prefix)),
  };
};

describe('release-pr', () => {
  test('名前と説明を持つ', () => {
    expect(command.name).toBe('release-pr');
    expect(command.description).not.toBe('');
  });

  test.each(['main', 'hotfix/fix-login'])(
    '環境変数RELEASE_HEADの%sについて、既存のPRを探し、差分のコミットを一覧にしてからprodへのPRを作る',
    async (head) => {
      const { code, lines, stdout, summaries } = await runWith([], {
        env: { ...RUN_ENV, RELEASE_HEAD: head },
      });

      expect(code).toBe(EXIT_SUCCESS);
      expect(lines).toEqual([
        listLineOf(head),
        logLineOf(head),
        createLineOf(head),
      ]);
      expect(stdout.text()).toContain(CREATED_URL);
      expect(summaries().join('')).toContain(CREATED_URL);
    },
  );

  test('PRの本文は引数でなく標準入力で渡し、コミットの一覧・確認項目・実行のURLを含める', async () => {
    const { callOf } = await runWith([]);
    const create = callOf('gh pr create');
    const body = create?.stdin ?? '';

    expect(create?.args.join(' ')).not.toContain('abc1234');
    expect(body).toContain('abc1234 機能を追加する\ndef5678 不具合を直す');
    expect(body).toContain('staging');
    expect(body).toContain('Expand/Contract');
    expect(body).toContain('prodの識別子');
    expect(body).toContain(RUN_URL);
  });

  test('ghにはGITHUB_TOKENをGH_TOKENとして渡し、すべての子プロセスをリポジトリの直下で実行する', async () => {
    const { calls, callOf } = await runWith([]);

    expect(callOf('gh pr list')?.env).toEqual({ GH_TOKEN: GITHUB_TOKEN });
    expect(callOf('gh pr create')?.env).toEqual({ GH_TOKEN: GITHUB_TOKEN });
    expect(calls.map((spec) => spec.cwd)).toEqual([
      FAKE_REPO_ROOT,
      FAKE_REPO_ROOT,
      FAKE_REPO_ROOT,
    ]);
    expect(calls.map((spec) => spec.output)).toEqual([
      'capture',
      'capture',
      'capture',
    ]);
  });

  test('同じリポジトリの既存のPRがあれば、その場所を示して作らずに成功する', async () => {
    const { code, lines, stdout, summaries } = await runWith([], {
      outputsOf: listOutputOf([
        { url: FORK_URL, isCrossRepository: true },
        { url: EXISTING_URL, isCrossRepository: false },
      ]),
    });

    expect(code).toBe(EXIT_SUCCESS);
    expect(lines).toEqual([listLineOf('main')]);
    expect(stdout.text()).toContain(EXISTING_URL);
    expect(summaries().join('')).toContain(EXISTING_URL);
    expect(stdout.text()).not.toContain(FORK_URL);
  });

  test('フォークから同じ名前のブランチで開かれたPRだけなら、既存とみなさずにPRを作る', async () => {
    const { code, lines, stdout } = await runWith([], {
      outputsOf: listOutputOf([{ url: FORK_URL, isCrossRepository: true }]),
    });

    expect(code).toBe(EXIT_SUCCESS);
    expect(lines).toEqual([
      listLineOf('main'),
      logLineOf('main'),
      createLineOf('main'),
    ]);
    expect(stdout.text()).toContain(CREATED_URL);
    expect(stdout.text()).not.toContain(FORK_URL);
  });

  test('既存のPRの一覧にフォークからのPRかが分からない要素があれば、作らずに失敗する', async () => {
    const { code, lines, stderr } = await runWith([], {
      outputsOf: listOutputOf([{ url: EXISTING_URL }]),
    });

    expect(code).toBe(EXIT_FAILURE);
    expect(lines).toEqual([listLineOf('main')]);
    expect(stderr.text()).toContain('読み取れません');
  });

  test('コミットが200件を超えたら、本文に先頭の200件と残りの件数とprodとの比較のURLを載せる', async () => {
    const { code, callOf } = await runWith([], {
      env: { ...RUN_ENV, RELEASE_HEAD: 'hotfix/fix-login' },
      outputsOf: (line) =>
        line.startsWith('git log')
          ? { stdout: manyCommitsLog(250) }
          : defaultOutputsOf(line),
    });
    const body = callOf('gh pr create')?.stdin ?? '';

    expect(code).toBe(EXIT_SUCCESS);
    expect(body).toContain('…ほか50件');
    expect(body).toContain(
      'https://github.example/owner/repo/compare/prod...hotfix/fix-login',
    );
  });

  test('headとprodの間にコミットが無ければ、作らずに知らせて成功する', async () => {
    const { code, lines, stdout, summaries } = await runWith([], {
      outputsOf: (line) =>
        line.startsWith('git log') ? { stdout: '\n' } : defaultOutputsOf(line),
    });

    expect(code).toBe(EXIT_SUCCESS);
    expect(lines).toEqual([listLineOf('main'), logLineOf('main')]);
    expect(stdout.text()).toContain('コミットがありません');
    expect(summaries().join('')).toContain('コミットがありません');
  });

  test.each([
    ['prod'],
    ['feature/login'],
    [''],
    ['main\n'],
    ['hotfix/fix\nmain'],
  ])('RELEASE_HEADが%pなら、子プロセスを実行せずに失敗する', async (head) => {
    const { code, calls, stderr } = await runWith([], {
      env: { ...RUN_ENV, RELEASE_HEAD: head },
    });

    expect(code).toBe(EXIT_FAILURE);
    expect(calls).toEqual([]);
    expect(stderr.text()).toContain('RELEASE_HEAD');
  });

  test('RELEASE_HEADが無ければ、子プロセスを実行せずに失敗する', async () => {
    const { code, calls, stderr } = await runWith([], { env: RUN_ENV });

    expect(code).toBe(EXIT_FAILURE);
    expect(calls).toEqual([]);
    expect(stderr.text()).toContain('RELEASE_HEAD');
  });

  test.each(Object.keys(RUN_ENV))(
    '%sが無ければ、子プロセスを実行せずに名前を示して失敗する',
    async (key) => {
      const env = Object.fromEntries(
        Object.entries({ ...RUN_ENV, RELEASE_HEAD: 'main' }).filter(
          ([name]) => name !== key,
        ),
      );

      const { code, calls, stderr } = await runWith([], { env });

      expect(code).toBe(EXIT_FAILURE);
      expect(calls).toEqual([]);
      expect(stderr.text()).toContain(key);
      expect(stderr.text()).not.toContain(GITHUB_TOKEN);
    },
  );

  test('既存のPRの一覧が失敗したら、出力を示して作らずに失敗する', async () => {
    const { code, lines, stderr } = await runWith([], {
      exitCodeOf: (line) => (line.startsWith('gh pr list') ? 1 : 0),
      outputsOf: (line) =>
        line.startsWith('gh pr list')
          ? { stderr: 'HTTP 401: Bad credentials' }
          : defaultOutputsOf(line),
    });

    expect(code).toBe(EXIT_FAILURE);
    expect(lines).toEqual([listLineOf('main')]);
    expect(stderr.text()).toContain('HTTP 401: Bad credentials');
    expect(stderr.text()).toContain('終了コード1');
  });

  test('既存のPRの一覧を読み取れなければ、作らずに失敗する', async () => {
    const { code, lines, stderr } = await runWith([], {
      outputsOf: (line) =>
        line.startsWith('gh pr list')
          ? { stdout: 'not json' }
          : defaultOutputsOf(line),
    });

    expect(code).toBe(EXIT_FAILURE);
    expect(lines).toEqual([listLineOf('main')]);
    expect(stderr.text()).toContain('読み取れません');
  });

  test('コミットの一覧が失敗したら、出力を示して作らずに失敗する', async () => {
    const { code, lines, stderr } = await runWith([], {
      env: { ...RUN_ENV, RELEASE_HEAD: 'hotfix/missing' },
      exitCodeOf: (line) => (line.startsWith('git log') ? 128 : 0),
      outputsOf: (line) =>
        line.startsWith('git log')
          ? {
              stderr:
                "fatal: bad revision 'origin/prod..origin/hotfix/missing'",
            }
          : defaultOutputsOf(line),
    });

    expect(code).toBe(EXIT_FAILURE);
    expect(lines).toEqual([
      listLineOf('hotfix/missing'),
      logLineOf('hotfix/missing'),
    ]);
    expect(stderr.text()).toContain('fatal: bad revision');
    expect(stderr.text()).toContain('終了コード128');
  });

  test('PRの作成が失敗したら、出力を示して失敗する', async () => {
    const { code, stderr, summaries } = await runWith([], {
      exitCodeOf: (line) => (line.startsWith('gh pr create') ? 1 : 0),
      outputsOf: (line) =>
        line.startsWith('gh pr create')
          ? { stderr: 'GraphQL: not permitted to create pull requests' }
          : defaultOutputsOf(line),
    });

    expect(code).toBe(EXIT_FAILURE);
    expect(stderr.text()).toContain(
      'GraphQL: not permitted to create pull requests',
    );
    expect(stderr.text()).toContain('終了コード1');
    expect(summaries()).toEqual([]);
  });

  test.each([
    [['--head', 'main'], '未知のオプションです: --head'],
    [['main'], 'オプションでない引数は受け取りません: main'],
    [['--', 'gh'], '`--`の後のコマンドは受け取りません'],
  ])(
    'headを引数%pで受け取らず、引数の誤りとして拒否する',
    async (args, message) => {
      const error = await runWith(args).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UsageError);
      expect(await rejectionMessageOf(runWith(args))).toBe(message);
    },
  );
});
