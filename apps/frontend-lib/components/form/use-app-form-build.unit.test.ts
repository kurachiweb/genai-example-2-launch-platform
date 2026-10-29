import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

const LIBRARY_ROOT = join(import.meta.dir, '..', '..');
const ENTRY = 'components/form/use-app-form.ts';
const BUILD_TIMEOUT_MS = 30_000;

const RESERVED_NAMES_CHECK = '欄のエラーと見分けられない名前';
const USE_APP_FORM_MARKER = 'onTouched';

// アプリのビルド(vite build)と同じくNodeの子プロセスでViteを動かし、useAppFormだけを入口にした出力のコードを書き出す。入口の公開を保たないと出力が空になり、判定の有無を確かめられない
const BUILD_SCRIPT = `
import { build } from 'vite';
const [entry] = process.argv.slice(1);
const result = await build({
  configFile: false,
  root: process.cwd(),
  logLevel: 'silent',
  build: {
    write: false,
    rolldownOptions: {
      input: entry,
      preserveEntrySignatures: 'strict',
      external: (id) => !id.startsWith('.') && !id.startsWith('/'),
    },
  },
});
const outputs = Array.isArray(result) ? result : [result];
process.stdout.write(
  outputs
    .flatMap(({ output }) => output)
    .filter((chunk) => chunk.type === 'chunk')
    .map((chunk) => chunk.code)
    .join('\\n'),
);
`;

// bun testはNODE_ENVをtestにするため、子プロセスへは除いて渡し、ビルドの時に指定した値だけを渡す
const buildEnvironmentOf = (
  nodeEnv: string | undefined,
): Record<string, string> => {
  const base = Object.fromEntries(
    Object.entries(Bun.env).filter(
      (entry): entry is [string, string] =>
        entry[0] !== 'NODE_ENV' && entry[1] !== undefined,
    ),
  );
  return nodeEnv === undefined ? base : { ...base, NODE_ENV: nodeEnv };
};

const buildUseAppForm = async (
  nodeEnv: string | undefined,
): Promise<string> => {
  const child = Bun.spawn(
    ['node', '--input-type=module', '-e', BUILD_SCRIPT, ENTRY],
    {
      cwd: LIBRARY_ROOT,
      env: buildEnvironmentOf(nodeEnv),
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const [code, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(exitCode, stderr).toBe(0);
  return code;
};

describe('useAppFormのビルドの出力', () => {
  test(
    'NODE_ENVを指定しない本番のビルドでは、既定値の予約された名前の判定を除き、例外を投げる処理を含まない',
    async () => {
      const code = await buildUseAppForm(undefined);

      expect(code).toContain(USE_APP_FORM_MARKER);
      expect(code).not.toContain(RESERVED_NAMES_CHECK);
      expect(code).not.toContain('NODE_ENV');
    },
    BUILD_TIMEOUT_MS,
  );

  test(
    '開発時のビルドでは、既定値の予約された名前の判定を含む',
    async () => {
      const code = await buildUseAppForm('development');

      expect(code).toContain(RESERVED_NAMES_CHECK);
    },
    BUILD_TIMEOUT_MS,
  );
});
