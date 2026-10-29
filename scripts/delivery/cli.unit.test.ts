import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type CliOptions, loadCommands, runCli } from './cli.ts';
import type { DeliveryDeps } from './commands/shared/delivery-command.ts';
import { createRecordingOutput } from './test-fixtures/text-output.ts';

const SPAWN_TIMEOUT_MS = 30_000;
const CLI_PATH = join(import.meta.dirname, 'cli.ts');
const REAL_COMMANDS_DIR = join(import.meta.dirname, 'commands');
const DELIVERY_COMMAND_MODULE = join(
  import.meta.dirname,
  'commands',
  'shared',
  'delivery-command.ts',
);

let root: string;
let commandsDir: string;

const writeFiles = async (
  dir: string,
  files: Readonly<Record<string, string>>,
): Promise<void> => {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(dir, path, '..'), { recursive: true });
    await writeFile(join(dir, path), text);
  }
};

const createCommandsDir = async (
  name: string,
  files: Readonly<Record<string, string>>,
): Promise<string> => {
  const dir = join(root, name);
  await writeFiles(dir, files);
  return dir;
};

const ALPHA_SOURCE = `
export const command = {
  name: 'alpha',
  description: '引数をそのまま表示し、最初の引数を終了コードにする',
  run: async (args, deps) => {
    deps.stdout.write(JSON.stringify({ args, marker: deps.env.DELIVERY_MARKER }));
    return Number(args[0] ?? '0');
  },
};
`;

// 実行されないコマンドの関数がカバレッジの分母で0%にならないよう、ソースに関数を持たない組み込みの関数を実行の値にする
const NEVER_RUN_ALPHA_SOURCE = `
export const command = {
  name: 'alpha',
  description: '実行されない',
  run: Promise.resolve.bind(Promise, 0),
};
`;

const BETA_SOURCE = `
import { UsageError } from ${JSON.stringify(DELIVERY_COMMAND_MODULE)};
export const command = {
  name: 'beta-check',
  description: '引数の誤りと想定外の失敗を起こす',
  run: async (args) => {
    if (args.includes('--bad')) throw new UsageError('--badは使えません');
    if (args.includes('--boom')) throw new Error('壊れました');
    throw 'エラーでない値';
  },
};
`;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'delivery-cli-'));
  commandsDir = await createCommandsDir('valid', {
    'beta-check.ts': BETA_SOURCE,
    'alpha.ts': ALPHA_SOURCE,
    'alpha.unit.test.ts': "throw new Error('テストファイルは読み込まない');\n",
    'shared/helper.ts': "throw new Error('サブディレクトリは読み込まない');\n",
    'README.md': '# 読み込まない\n',
  });
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const run = async (
  args: readonly string[],
  overrides: Partial<CliOptions> = {},
) => {
  const stdout = createRecordingOutput();
  const stderr = createRecordingOutput();
  let depsCreated = 0;
  const code = await runCli({
    args,
    commandsDir,
    createDeps: () => {
      depsCreated += 1;
      return {
        env: { DELIVERY_MARKER: 'fake-deps' },
        stdout,
      } as unknown as DeliveryDeps;
    },
    stdout,
    stderr,
    ...overrides,
  });
  return { code, stdout: stdout.text(), stderr: stderr.text(), depsCreated };
};

const USAGE_LINES = [
  '使い方: bun scripts/delivery/cli.ts <サブコマンド> [引数...]',
  '',
  'サブコマンド:',
  '  alpha       引数をそのまま表示し、最初の引数を終了コードにする',
  '  beta-check  引数の誤りと想定外の失敗を起こす',
  '',
];

describe('runCli', () => {
  test.each(['--help', '-h', 'help'])(
    '%sはサブコマンドの一覧を名前の順に標準出力へ表示して終了コード0を返す',
    async (flag) => {
      const result = await run([flag]);

      expect(result.code).toBe(0);
      expect(result.stdout).toBe(USAGE_LINES.join('\n'));
      expect(result.stderr).toBe('');
      expect(result.depsCreated).toBe(0);
    },
  );

  test('サブコマンドが無ければ一覧を標準エラー出力へ表示して終了コード2を返す', async () => {
    const result = await run([]);

    expect(result.code).toBe(2);
    expect(result.stderr).toBe(
      ['サブコマンドを指定してください。', ...USAGE_LINES].join('\n'),
    );
  });

  test.each([
    'nope',
    '../valid/alpha',
    'Alpha',
    'alpha.ts',
    'alpha.unit.test',
    'shared/helper',
  ])('未知のサブコマンド%pは一覧を示して終了コード2を返す', async (name) => {
    const result = await run([name]);

    expect(result.code).toBe(2);
    expect(result.stderr).toBe(
      [`未知のサブコマンドです: ${name}`, ...USAGE_LINES].join('\n'),
    );
    expect(result.depsCreated).toBe(0);
  });

  test('ファイル名から解決したサブコマンドに残りの引数と依存を渡し、その終了コードを返す', async () => {
    const succeeded = await run(['alpha', '0', '--flag']);
    const violated = await run(['alpha', '1']);

    expect(succeeded.code).toBe(0);
    expect(JSON.parse(succeeded.stdout)).toEqual({
      args: ['0', '--flag'],
      marker: 'fake-deps',
    });
    expect(succeeded.depsCreated).toBe(1);
    expect(violated.code).toBe(1);
  });

  test('サブコマンドの引数の誤りは理由とヘルプの案内を表示して終了コード2を返す', async () => {
    const result = await run(['beta-check', '--bad']);

    expect(result.code).toBe(2);
    expect(result.stderr).toBe(
      'beta-check: --badは使えません\n一覧は bun scripts/delivery/cli.ts --help で確かめてください。\n',
    );
  });

  test('サブコマンドの想定外の失敗は理由を表示して終了コード1を返す', async () => {
    const boom = await run(['beta-check', '--boom']);
    const thrownValue = await run(['beta-check']);

    expect(boom.code).toBe(1);
    expect(boom.stderr).toBe('beta-check: 壊れました\n');
    expect(thrownValue.code).toBe(1);
    expect(thrownValue.stderr).toBe('beta-check: エラーでない値\n');
  });

  test('共通の形を公開しないコマンドのファイルがあれば、一覧も実行もファイルを示して終了コード1を返す', async () => {
    const brokenDir = await createCommandsDir('broken', {
      'alpha.ts': NEVER_RUN_ALPHA_SOURCE,
      'broken.ts': 'export const other = 1;\n',
    });

    const help = await run(['--help'], { commandsDir: brokenDir });
    const direct = await run(['broken'], { commandsDir: brokenDir });

    expect(help.code).toBe(1);
    expect(help.stderr).toBe(
      'broken.tsが、名前・説明・実行を持つcommandを公開していません。\n',
    );
    expect(direct.code).toBe(1);
    expect(direct.stderr).toBe(help.stderr);
  });

  test('ファイル名と名前が異なるコマンドは、一覧も実行もファイルを示して終了コード1を返す', async () => {
    const mismatchDir = await createCommandsDir('mismatch', {
      'gamma.ts': NEVER_RUN_ALPHA_SOURCE,
    });

    const result = await run(['gamma'], { commandsDir: mismatchDir });

    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      'gamma.tsのcommandの名前(alpha)がファイル名と一致しません。\n',
    );
  });

  test('コマンドが1つも無ければ、一覧に無い旨を表示する', async () => {
    const emptyDir = await createCommandsDir('empty', { 'README.md': '' });

    const result = await run(['--help'], { commandsDir: emptyDir });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('サブコマンド:\n  (なし)\n');
  });
});

describe('loadCommands', () => {
  test('実際のコマンドのディレクトリの全ファイルが、ファイル名と同じ名前の共通の形を公開する', async () => {
    const commands = await loadCommands(REAL_COMMANDS_DIR);

    for (const command of commands) {
      expect(command.description).not.toBe('');
    }
  });
});

describe('cli.tsの直接の実行', () => {
  test(
    '--helpでサブコマンドの一覧を表示して終了コード0、未知のサブコマンドで終了コード2を返す',
    () => {
      const help = Bun.spawnSync([process.execPath, CLI_PATH, '--help'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const unknown = Bun.spawnSync(
        [process.execPath, CLI_PATH, 'delivery-no-such-command'],
        { stdout: 'pipe', stderr: 'pipe' },
      );

      expect(help.exitCode).toBe(0);
      expect(help.stdout.toString()).toStartWith(
        '使い方: bun scripts/delivery/cli.ts <サブコマンド> [引数...]\n\nサブコマンド:\n',
      );
      expect(unknown.exitCode).toBe(2);
      expect(unknown.stderr.toString()).toStartWith(
        '未知のサブコマンドです: delivery-no-such-command\n',
      );
    },
    SPAWN_TIMEOUT_MS,
  );
});
