import { readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import type { GraphQLSchema } from 'graphql';

import { GRAPHQL_SCHEMA_MODULES } from '../../src/composition/graphql-modules.ts';
import {
  composeGatewaySchema,
  printGatewaySchema,
} from '../../src/presentation/graphql/schema-composer.ts';
import { buildAllowlist, serializeAllowlist } from './allowlist-builder.ts';
import { readWorkingTreeSources } from './allowlist-sources.ts';
import { createDocumentValidator } from './document-validator.ts';
import {
  type ArtifactCheck,
  compareGenerated,
  reportGeneratedChecks,
  resolverTypesCheckOf,
} from './generated-check.ts';

const API_DIR = resolve(import.meta.dirname, '..', '..');

const REPO_ROOT = resolve(API_DIR, '..', '..');

const GENERATED_DIR = join(
  API_DIR,
  'src',
  'presentation',
  'graphql',
  'generated',
);

const SCHEMA_FILE = join(GENERATED_DIR, 'schema.graphql');

const ALLOWLIST_FILE = join(GENERATED_DIR, 'allowlist.json');

const CODEGEN_BIN = join(API_DIR, 'node_modules', '.bin', 'graphql-codegen');

const CODEGEN_CONFIG = join(API_DIR, 'codegen.config.ts');

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isFileMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function readGeneratedFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isFileMissing(error)) {
      return undefined;
    }
    throw error;
  }
}

async function checkSchema(schema: GraphQLSchema): Promise<ArtifactCheck> {
  return compareGenerated(
    'schema',
    printGatewaySchema(schema),
    await readGeneratedFile(SCHEMA_FILE),
  );
}

async function checkResolverTypes(): Promise<ArtifactCheck> {
  const codegen = Bun.spawn(
    [CODEGEN_BIN, '--config', CODEGEN_CONFIG, '--check'],
    { cwd: API_DIR, stdout: 'inherit', stderr: 'inherit' },
  );
  return resolverTypesCheckOf(await codegen.exited);
}

async function checkAllowlist(schema: GraphQLSchema): Promise<ArtifactCheck> {
  const result = await buildAllowlist({
    current: await readWorkingTreeSources(REPO_ROOT),
    previous: undefined,
    validate: createDocumentValidator(schema),
  });
  if (!result.ok) {
    return {
      artifact: 'allowlist',
      status: 'unbuildable',
      errors: result.errors,
    };
  }
  return compareGenerated(
    'allowlist',
    serializeAllowlist(result.allowlist),
    await readGeneratedFile(ALLOWLIST_FILE),
  );
}

async function check(): Promise<number> {
  const schema = composeGatewaySchema(GRAPHQL_SCHEMA_MODULES);
  const checks = [
    await checkSchema(schema),
    await checkResolverTypes(),
    await checkAllowlist(schema),
  ];
  const { exitCode, stdout, stderr } = reportGeneratedChecks(
    checks,
    relative(REPO_ROOT, API_DIR),
  );
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  return exitCode;
}

async function main(): Promise<number> {
  try {
    return await check();
  } catch (error) {
    process.stderr.write(
      `GraphQLの生成物の検査を完了できませんでした: ${errorMessage(error)}\n`,
    );
    return 1;
  }
}

process.exit(await main());
