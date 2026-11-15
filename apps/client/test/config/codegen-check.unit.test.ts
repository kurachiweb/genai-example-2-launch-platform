import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const APP_DIR = join(import.meta.dirname, '..', '..');

const SCHEMA_PATH = join(
  'src',
  'presentation',
  'graphql',
  'generated',
  'schema.graphql',
);

const OPERATION_PATH = join(
  'src',
  'graphql',
  'operations',
  'system-status.graphql',
);

const GENERATED_PATH = join('src', 'graphql', 'generated');

const REGENERATE_GUIDANCE = [
  '生成物が操作の定義またはスキーマと食い違っています。',
  '次の生成コマンドを再実行し、生成物を更新してください。',
  '  bun run graphql:generate',
].join('\n');

const UP_TO_DATE_MESSAGE =
  'GraphQLの生成物は操作の定義とスキーマから生成した内容と一致しています。';

// 子プロセスでのgraphql-codegenの生成と検査は、単体テストの既定の5秒を超え得る
const CODEGEN_PROCESS_TIMEOUT_MS = 30_000;

// bun testはNODE_ENVをtestにし、graphql-codegenはその時に検証の失敗の詳細を出さないため、開発者の端末と同じくNODE_ENVを外して起動する
const SCRIPT_ENV = Object.fromEntries(
  Object.entries(Bun.env).filter(([key]) => key !== 'NODE_ENV'),
);

interface ScriptResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

let workRoot: string;

let workAppDir: string;

const runScript = async (script: string): Promise<ScriptResult> => {
  const child = Bun.spawn([process.execPath, 'run', script], {
    cwd: workAppDir,
    env: SCRIPT_ENV,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
};

const writeOperation = async (body: string): Promise<void> => {
  await writeFile(join(workAppDir, OPERATION_PATH), body);
};

// codegen.config.tsのスキーマの相対パス(../api/…)が一時ディレクトリでも同じ写しを指すよう、アプリとAPIサーバーを兄弟に置く
beforeEach(async () => {
  workRoot = await mkdtemp(join(tmpdir(), 'client-codegen-check-test-'));
  workAppDir = join(workRoot, 'client');
  const workSchemaPath = join(workRoot, 'api', SCHEMA_PATH);
  await mkdir(dirname(workSchemaPath), { recursive: true });
  await cp(join(APP_DIR, '..', 'api', SCHEMA_PATH), workSchemaPath);
  await mkdir(dirname(join(workAppDir, OPERATION_PATH)), { recursive: true });
  for (const file of ['package.json', 'codegen.config.ts', OPERATION_PATH]) {
    await cp(join(APP_DIR, file), join(workAppDir, file));
  }
  for (const dir of ['node_modules', 'lib']) {
    await symlink(join(APP_DIR, dir), join(workAppDir, dir));
  }
  const generated = await runScript('graphql:generate');
  expect(generated.exitCode).toBe(0);
}, CODEGEN_PROCESS_TIMEOUT_MS);

afterEach(async () => {
  await rm(workRoot, { recursive: true, force: true });
});

describe('利用者側のコード生成の検査(graphql:check)', () => {
  test(
    '生成物が操作とスキーマから生成した内容と一致すれば、一致を示して終了コード0で終える',
    async () => {
      const result = await runScript('graphql:check');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(UP_TO_DATE_MESSAGE);
      expect(result.stderr).not.toContain(REGENERATE_GUIDANCE);
    },
    { timeout: CODEGEN_PROCESS_TIMEOUT_MS },
  );

  test(
    '操作を変えて生成し直さなければ、古い生成物と再実行すべき生成コマンドを示して終了コード1で終える',
    async () => {
      const operation = await readFile(
        join(workAppDir, OPERATION_PATH),
        'utf8',
      );
      expect(operation).toContain('serverTime');
      await writeOperation(operation.replace('serverTime', ''));

      const result = await runScript('graphql:check');

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(join(GENERATED_PATH, 'graphql.ts'));
      expect(result.stderr).toContain(REGENERATE_GUIDANCE);
    },
    { timeout: CODEGEN_PROCESS_TIMEOUT_MS },
  );

  test(
    '操作がスキーマに無い項目を選べば、検証の失敗と再実行すべき生成コマンドを示して終了コード1で終える',
    async () => {
      await writeOperation(
        'query ClientSystemStatus { systemStatus { databaseReachable missingField } }\n',
      );

      const result = await runScript('graphql:check');

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('missingField');
      expect(result.stderr).toContain(REGENERATE_GUIDANCE);
    },
    { timeout: CODEGEN_PROCESS_TIMEOUT_MS },
  );
});
