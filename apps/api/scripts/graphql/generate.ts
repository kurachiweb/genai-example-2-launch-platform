import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { GRAPHQL_SCHEMA_MODULES } from '../../src/composition/graphql-modules.ts';
import {
  composeGatewaySchema,
  printGatewaySchema,
} from '../../src/presentation/graphql/schema-composer.ts';

const API_DIR = resolve(import.meta.dirname, '..', '..');

const SCHEMA_FILE = join(
  API_DIR,
  'src',
  'presentation',
  'graphql',
  'generated',
  'schema.graphql',
);

const CODEGEN_BIN = join(API_DIR, 'node_modules', '.bin', 'graphql-codegen');

const CODEGEN_CONFIG = join(API_DIR, 'codegen.config.ts');

async function runCodegen(): Promise<number> {
  const codegen = Bun.spawn([CODEGEN_BIN, '--config', CODEGEN_CONFIG], {
    cwd: API_DIR,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  return codegen.exited;
}

async function generate(): Promise<number> {
  const printed = printGatewaySchema(
    composeGatewaySchema(GRAPHQL_SCHEMA_MODULES),
  );
  await writeFile(SCHEMA_FILE, printed);
  process.stdout.write(`スキーマファイルを出力しました: ${SCHEMA_FILE}\n`);

  const exitCode = await runCodegen();
  if (exitCode !== 0) {
    process.stderr.write(
      `graphql-codegenが終了コード${String(exitCode)}で失敗しました。\n`,
    );
  }
  return exitCode;
}

process.exit(await generate());
