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

const OPERATIONS_DIR = join(SRC_DIR, 'graphql', 'operations');

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

const IDENTITY_OPERATION_NAMES = [
  'ClientViewer',
  'ClientMySessions',
  'ClientRegisterUser',
  'ClientLogin',
  'ClientCompleteSecondFactorLogin',
  'ClientLogout',
  'ClientVerifyEmail',
  'ClientResendVerificationEmail',
  'ClientRequestPasswordReset',
  'ClientResetPassword',
  'ClientRequestEmailChange',
  'ClientConfirmEmailChange',
  'ClientRequestPasswordChange',
  'ClientConfirmPasswordChange',
  'ClientWithdraw',
  'ClientRevokeSession',
  'ClientRevokeOtherSessions',
  'ClientStartTotpSetup',
  'ClientEnableTotp',
  'ClientDisableTotp',
  'ClientRegenerateRecoveryCodes',
] as const;

const PAYMENTS_OPERATION_NAMES = [
  'ClientCheckout',
  'ClientRecordCheckoutConsent',
  'ClientStartSmokeCheckout',
  'ClientConfirmCheckoutReturn',
  'ClientPaymentHistory',
] as const;

const bodyOfOperation = (
  documents: Record<string, string>,
  name: string,
): string | undefined =>
  Object.values(documents).find((body) =>
    operationsOf(body).some((operation) => operation.name?.value === name),
  );

const operationFiles = async (): Promise<string[]> =>
  (await readdir(OPERATIONS_DIR, { recursive: true })).filter((path) =>
    path.endsWith('.graphql'),
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

  test.each(IDENTITY_OPERATION_NAMES)(
    '操作の一覧は利用者のアカウントの操作%sを持つ',
    async (name) => {
      const documents = await readPersistedDocuments(GENERATED_DIR);

      expect(bodyOfOperation(documents, name)).toBeDefined();
    },
  );

  test.each(PAYMENTS_OPERATION_NAMES)(
    '操作の一覧は決済の操作%sを持つ',
    async (name) => {
      const documents = await readPersistedDocuments(GENERATED_DIR);

      expect(bodyOfOperation(documents, name)).toBeDefined();
    },
  );

  test('ヘッダーが使う利用者の取得ClientViewerは、リカバリコードの残数を要求せず表示と判定に要る項目だけを取得する', async () => {
    const documents = await readPersistedDocuments(GENERATED_DIR);

    const body = bodyOfOperation(documents, 'ClientViewer');

    expect(print(parse(body ?? ''))).toBe(
      print(
        parse(
          'query ClientViewer { viewer { emailVerified handle id nickname status totpEnabled } }',
        ),
      ),
    );
  });

  test('セキュリティの設定ページの取得ClientMySessionsは、セッションの一覧と多要素認証の状態とリカバリコードの残数を1つの操作で取得する', async () => {
    const documents = await readPersistedDocuments(GENERATED_DIR);

    const body = bodyOfOperation(documents, 'ClientMySessions');

    expect(print(parse(body ?? ''))).toBe(
      print(
        parse(
          'query ClientMySessions { mySessions { browserName createdAt current id lastUsedAt osName } viewer { id remainingRecoveryCodes totpEnabled } }',
        ),
      ),
    );
  });

  test('操作のファイルはすべて1ファイルに1つの操作だけを持つ', async () => {
    const files = await operationFiles();

    const counts = await Promise.all(
      files.map(async (file) => ({
        file,
        operations: operationsOf(
          await readFile(join(OPERATIONS_DIR, file), 'utf8'),
        ).length,
      })),
    );

    expect(files.length).toBeGreaterThan(0);
    expect(counts.filter(({ operations }) => operations !== 1)).toEqual([]);
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
