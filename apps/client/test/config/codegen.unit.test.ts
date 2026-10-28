import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Kind, type OperationDefinitionNode, parse, print } from 'graphql';

import { documentIdOf } from '../../lib/utilities/graphql/persisted-document.ts';
import { z } from '../../lib/utilities/validation/zod.ts';
import { ClientSystemStatusDocument } from '../../src/graphql/generated/graphql.ts';

const APP_DIR = join(import.meta.dirname, '..', '..');

const SRC_DIR = join(APP_DIR, 'src');

const GENERATED_DIR = join(SRC_DIR, 'graphql', 'generated');

const ADMIN_GENERATED_DIR = join(
  APP_DIR,
  '..',
  'admin',
  'src',
  'graphql',
  'generated',
);

const PERSISTED_DOCUMENTS_FILE = 'persisted-documents.json';

const DOCUMENT_MODULE_FILE = 'graphql.ts';

const DOCUMENT_ID_PATTERN = /^sha256:[0-9a-f]{64}$/u;

// gql.ts・index.tsはgraphql()の対応表として操作の本文を文字列のまま持つため、画面から読み込むと本文がブラウザのバンドルに入る
const BODY_HOLDING_MODULE_IMPORT =
  /from\s+['"][^'"]*\/generated(?:\/(?:gql|index)(?:\.ts)?)?['"]/u;

const persistedDocumentsSchema = z.record(z.string(), z.string());

const readPersistedDocuments = async (
  generatedDir: string,
): Promise<Record<string, string>> =>
  persistedDocumentsSchema.parse(
    JSON.parse(
      await readFile(join(generatedDir, PERSISTED_DOCUMENTS_FILE), 'utf8'),
    ),
  );

const sha256DocumentIdOf = (body: string): string =>
  `sha256:${createHash('sha256').update(body, 'utf8').digest('hex')}`;

const operationsOf = (body: string): OperationDefinitionNode[] =>
  parse(body).definitions.filter(
    (definition): definition is OperationDefinitionNode =>
      definition.kind === Kind.OPERATION_DEFINITION,
  );

const appSourceFiles = async (): Promise<string[]> =>
  (await readdir(SRC_DIR, { recursive: true })).filter(
    (path) =>
      /\.tsx?$/u.test(path) && !path.startsWith(join('graphql', 'generated')),
  );

describe('利用者側のコード生成の生成物', () => {
  test('操作の一覧の識別子はすべてsha256:と64桁の小文字の16進で、本文のSHA-256と一致する', async () => {
    const documents = await readPersistedDocuments(GENERATED_DIR);

    expect(Object.keys(documents).length).toBeGreaterThan(0);
    for (const [documentId, body] of Object.entries(documents)) {
      expect(documentId).toMatch(DOCUMENT_ID_PATTERN);
      expect(documentId).toBe(sha256DocumentIdOf(body));
    }
  });

  test('操作の一覧は疎通確認の操作ClientSystemStatusを持ち、APIサーバーの時刻とデータベースへの到達可否を取得する', async () => {
    const documents = await readPersistedDocuments(GENERATED_DIR);

    const body = documents[documentIdOf(ClientSystemStatusDocument)];

    expect(body).toBeDefined();
    expect(print(parse(body ?? ''))).toBe(
      print(
        parse(
          'query ClientSystemStatus { systemStatus { databaseReachable serverTime } }',
        ),
      ),
    );
  });

  test('操作の一覧の操作はすべて利用者側の名前を持ち、管理者側の操作を含まない', async () => {
    const documents = await readPersistedDocuments(GENERATED_DIR);

    const names = Object.values(documents)
      .flatMap(operationsOf)
      .map((operation) => operation.name?.value);

    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name).toStartWith('Client');
    }
  });

  test('操作の一覧は管理者側の操作の一覧と識別子を共有しない', async () => {
    const clientDocumentIds = Object.keys(
      await readPersistedDocuments(GENERATED_DIR),
    );

    const adminDocumentIds = Object.keys(
      await readPersistedDocuments(ADMIN_GENERATED_DIR),
    );

    expect(adminDocumentIds.length).toBeGreaterThan(0);
    expect(
      clientDocumentIds.filter((documentId) =>
        adminDocumentIds.includes(documentId),
      ),
    ).toEqual([]);
  });

  test('疎通確認の操作の文書は識別子だけを持ち、操作の構文木と位置の情報を持たない', () => {
    expect(Object.keys(ClientSystemStatusDocument)).toEqual(['__meta__']);
    expect(documentIdOf(ClientSystemStatusDocument)).toMatch(
      DOCUMENT_ID_PATTERN,
    );
  });

  test('画面が読み込む生成物のgraphql.tsは操作の本文を含まない', async () => {
    const bodies = Object.values(await readPersistedDocuments(GENERATED_DIR));

    const source = await readFile(
      join(GENERATED_DIR, DOCUMENT_MODULE_FILE),
      'utf8',
    );

    for (const body of bodies) {
      expect(source).not.toContain(body);
    }
    expect(source).not.toMatch(/systemStatus\s*\{/u);
  });

  test('画面のコードは操作の本文を持つ生成物のgql.ts・index.tsを読み込まない', async () => {
    const files = await appSourceFiles();

    const importing = [];
    for (const file of files) {
      const source = await readFile(join(SRC_DIR, file), 'utf8');
      if (BODY_HOLDING_MODULE_IMPORT.test(source)) {
        importing.push(file);
      }
    }

    expect(importing).toEqual([]);
  });
});
