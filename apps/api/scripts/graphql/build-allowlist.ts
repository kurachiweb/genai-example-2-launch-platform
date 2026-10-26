import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { GRAPHQL_SCHEMA_MODULES } from '../../src/composition/graphql-modules.ts';
import { composeGatewaySchema } from '../../src/presentation/graphql/schema-composer.ts';
import {
  type AllowlistBuildError,
  buildAllowlist,
  type ExcludedOperation,
  type PersistedDocumentsByCaller,
  serializeAllowlist,
} from './allowlist-builder.ts';
import { readGitSources, readWorkingTreeSources } from './allowlist-sources.ts';
import { parseCliArgs } from './cli-args.ts';
import { createDocumentValidator } from './document-validator.ts';

const API_DIR = resolve(import.meta.dirname, '..', '..');

const REPO_ROOT = resolve(API_DIR, '..', '..');

const ALLOWLIST_FILE = join(
  API_DIR,
  'src',
  'presentation',
  'graphql',
  'generated',
  'allowlist.json',
);

const BUILD_ERROR_MESSAGES = {
  invalid_id: '識別子の形式が正しくありません',
  hash_mismatch: '識別子が本文のSHA-256と一致しません',
  conflicting_document: '現行と直前のリリースで同じ識別子の本文が異なります',
  current_invalid: '現行の操作がスキーマまたは上限の検証に通りません',
} as const satisfies Record<AllowlistBuildError['kind'], string>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function describeBuildError(error: AllowlistBuildError): string {
  const reasons =
    error.kind === 'current_invalid' ? `(${error.reasons.join('・')})` : '';
  return `  ${BUILD_ERROR_MESSAGES[error.kind]}${reasons}: ${error.caller} ${error.documentId}`;
}

function describeExcluded({
  caller,
  documentId,
  reasons,
}: ExcludedOperation): string {
  return `  ${caller} ${documentId}(${reasons.join('・')})`;
}

async function readPreviousSources(
  previousRef: string | undefined,
): Promise<PersistedDocumentsByCaller | undefined> {
  if (previousRef === undefined) {
    process.stdout.write(
      '直前のリリースのコミット(--previous-ref)が指定されていないため、現行の操作だけで許可リストを生成します。\n',
    );
    return undefined;
  }
  return readGitSources(REPO_ROOT, previousRef);
}

async function buildAndWrite(previousRef: string | undefined): Promise<number> {
  const current = await readWorkingTreeSources(REPO_ROOT);
  const previous = await readPreviousSources(previousRef);
  const result = await buildAllowlist({
    current,
    previous,
    validate: createDocumentValidator(
      composeGatewaySchema(GRAPHQL_SCHEMA_MODULES),
    ),
  });
  if (!result.ok) {
    process.stderr.write(
      `許可リストを生成できませんでした。\n${result.errors.map(describeBuildError).join('\n')}\n`,
    );
    return 1;
  }
  if (result.excluded.length > 0) {
    process.stderr.write(
      `警告: 直前のリリースの操作のうち、現行のスキーマまたは上限の検証に通らない${String(result.excluded.length)}件を許可リストから除外しました。\n${result.excluded.map(describeExcluded).join('\n')}\n`,
    );
  }
  await writeFile(ALLOWLIST_FILE, serializeAllowlist(result.allowlist));
  const { client, admin } = result.allowlist.operations;
  process.stdout.write(
    `許可リストを出力しました(client: ${String(Object.keys(client).length)}件、admin: ${String(Object.keys(admin).length)}件): ${ALLOWLIST_FILE}\n`,
  );
  return 0;
}

async function main(): Promise<number> {
  try {
    const { previousRef } = parseCliArgs(process.argv.slice(2));
    return await buildAndWrite(previousRef);
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`);
    return 1;
  }
}

process.exit(await main());
