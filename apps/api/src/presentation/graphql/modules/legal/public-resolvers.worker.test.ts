import { resetSync } from '@logtape/logtape';
import {
  type GraphQLSchema,
  type GraphQLType,
  isEnumType,
  isInputObjectType,
  isObjectType,
} from 'graphql';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'vitest';

import type { LegalDocumentKind } from '../../../../../common-lib/legal/legal-documents.ts';
import { createAdminTestContainer as createContainer } from '../../../../../test/support/admin-graphql-harness.ts';
import { createGraphQLGateway } from '../../../../../test/support/graphql-gateway.ts';
import { configureRecordingLogs } from '../../../../../test/support/observability-recording.ts';
import type { LegalDocumentAdminReader } from '../../../../application/legal/legal-document-admin-reader.ts';
import type { LegalDocumentPublisher } from '../../../../application/legal/legal-document-publisher.ts';
import type { LegalDraftEditor } from '../../../../application/legal/legal-draft-editor.ts';
import { LEGAL_TYPES } from '../../../../application/legal/legal-types.ts';
import {
  adminIdOf,
  clearAdminTables,
  insertAdmin,
} from '../../../../infrastructure/admin/testing/admin-store-fixtures.ts';
import { resetLegalTables } from '../../../../infrastructure/legal/testing/legal-store-fixtures.ts';
import { composeGatewaySchema } from '../../schema-composer.ts';
import { legalSchemaModule } from './index.ts';

interface LegalRevisionFields {
  readonly versionNumber: number;
  readonly publishedAt: string;
  readonly changeSummary: string;
}

interface LegalDocumentVersionFields extends LegalRevisionFields {
  readonly kind: string;
  readonly body: string;
  readonly isLatest: boolean;
}

interface LegalDocumentFields {
  readonly kind: string;
  readonly latest: LegalDocumentVersionFields | null;
  readonly revisions: readonly LegalRevisionFields[];
}

const LEGAL_DOCUMENT = /* GraphQL */ `
  query ClientLegalDocument($kind: LegalDocumentKind!) {
    legalDocument(kind: $kind) {
      kind
      latest {
        kind
        versionNumber
        publishedAt
        changeSummary
        body
        isLatest
      }
      revisions {
        versionNumber
        publishedAt
        changeSummary
      }
    }
  }
`;

const LEGAL_DOCUMENT_VERSION = /* GraphQL */ `
  query ClientLegalDocumentVersion(
    $kind: LegalDocumentKind!
    $versionNumber: Int!
  ) {
    legalDocumentVersion(kind: $kind, versionNumber: $versionNumber) {
      kind
      versionNumber
      publishedAt
      changeSummary
      body
      isLatest
    }
  }
`;

const gateway = createGraphQLGateway({
  documents: [LEGAL_DOCUMENT, LEGAL_DOCUMENT_VERSION],
  schemaModules: [legalSchemaModule],
});

const EDITOR = 1;

async function stateVersionOf(kind: LegalDocumentKind): Promise<number> {
  return (
    await createContainer()
      .get<LegalDocumentAdminReader>(LEGAL_TYPES.LegalDocumentAdminReader)
      .getDocument(kind)
  ).stateVersion;
}

async function saveDraft(kind: LegalDocumentKind, body: string): Promise<void> {
  await createContainer()
    .get<LegalDraftEditor>(LEGAL_TYPES.LegalDraftEditor)
    .save({
      adminId: adminIdOf(EDITOR),
      kind,
      expectedStateVersion: await stateVersionOf(kind),
      body,
    });
}

async function publish(
  kind: LegalDocumentKind,
  body: string,
  changeSummary: string,
): Promise<void> {
  await saveDraft(kind, body);
  await createContainer()
    .get<LegalDocumentPublisher>(LEGAL_TYPES.LegalDocumentPublisher)
    .publish({
      adminId: adminIdOf(EDITOR),
      kind,
      expectedStateVersion: await stateVersionOf(kind),
      changeSummary,
    });
}

function fetchDocument(kind: string) {
  return gateway.call<{ legalDocument: LegalDocumentFields }>(LEGAL_DOCUMENT, {
    kind,
  });
}

function fetchVersion(kind: string, versionNumber: number) {
  return gateway.call<{
    legalDocumentVersion: LegalDocumentVersionFields | null;
  }>(LEGAL_DOCUMENT_VERSION, { kind, versionNumber });
}

function fieldsOf(
  schema: GraphQLSchema,
  typeName: string,
): Record<string, string> {
  const type = schema.getType(typeName);
  const fields: Readonly<Record<string, { readonly type: GraphQLType }>> =
    isObjectType(type) || isInputObjectType(type) ? type.getFields() : {};
  return Object.fromEntries(
    Object.entries(fields).map(([name, field]) => [name, String(field.type)]),
  );
}

const RFC3339_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

beforeAll(() => {
  configureRecordingLogs();
});

beforeEach(async () => {
  await clearAdminTables();
  await resetLegalTables();
  await insertAdmin(EDITOR, { role: 'super_admin' });
});

afterAll(() => {
  resetSync();
});

describe('legalDocument', () => {
  test('未ログインの利用者側の呼び出しで、準備中の文書は最新版がnullで改訂履歴が空になる', async () => {
    const response = await fetchDocument('TERMS');

    expect(response.status).toBe(200);
    expect(response.errors).toBeUndefined();
    expect(response.data?.legalDocument).toEqual({
      kind: 'TERMS',
      latest: null,
      revisions: [],
    });
  });

  test('公開した版の本文を最新版とし、改訂履歴を新しい順に返し、公開の後の下書きを含めない', async () => {
    await publish('legal-notice', '# 法的通知 初版', '初版');
    await publish('legal-notice', '# 法的通知 第2版', '連絡先の変更');
    await saveDraft('legal-notice', '# 下書きの本文');

    const response = await fetchDocument('LEGAL_NOTICE');

    expect(response.errors).toBeUndefined();
    const document = response.data?.legalDocument;
    expect(document?.kind).toBe('LEGAL_NOTICE');
    expect(document?.latest).toMatchObject({
      kind: 'LEGAL_NOTICE',
      versionNumber: 2,
      changeSummary: '連絡先の変更',
      body: '# 法的通知 第2版',
      isLatest: true,
    });
    expect(document?.latest?.publishedAt).toMatch(RFC3339_UTC_PATTERN);
    expect(
      document?.revisions.map(({ versionNumber, changeSummary }) => ({
        versionNumber,
        changeSummary,
      })),
    ).toEqual([
      { versionNumber: 2, changeSummary: '連絡先の変更' },
      { versionNumber: 1, changeSummary: '初版' },
    ]);
    expect(document?.revisions[0]?.publishedAt).toBe(
      document?.latest?.publishedAt,
    );
  });

  test('他の種類の文書の版を含めない', async () => {
    await publish('privacy', '# プライバシーポリシー', '初版');

    const terms = await fetchDocument('TERMS');
    const privacy = await fetchDocument('PRIVACY');

    expect(terms.data?.legalDocument.latest).toBeNull();
    expect(privacy.data?.legalDocument.latest?.kind).toBe('PRIVACY');
  });
});

describe('legalDocumentVersion', () => {
  test('未ログインの利用者側の呼び出しで、過去の版を最新版でないものとして返す', async () => {
    await publish('terms', '# 利用規約 初版', '初版');
    await publish('terms', '# 利用規約 第2版', '禁止事項の追加');

    const first = await fetchVersion('TERMS', 1);
    const second = await fetchVersion('TERMS', 2);

    expect(first.errors).toBeUndefined();
    expect(first.data?.legalDocumentVersion).toMatchObject({
      kind: 'TERMS',
      versionNumber: 1,
      changeSummary: '初版',
      body: '# 利用規約 初版',
      isLatest: false,
    });
    expect(second.data?.legalDocumentVersion).toMatchObject({
      versionNumber: 2,
      body: '# 利用規約 第2版',
      isLatest: true,
    });
  });

  test('存在しない版と、準備中の文書の版はエラーにせずnullを返す', async () => {
    await publish('terms', '# 利用規約', '初版');

    const missing = await fetchVersion('TERMS', 2);
    const unpublished = await fetchVersion('PRIVACY', 1);

    expect(missing.errors).toBeUndefined();
    expect(missing.data?.legalDocumentVersion).toBeNull();
    expect(unpublished.errors).toBeUndefined();
    expect(unpublished.data?.legalDocumentVersion).toBeNull();
  });

  test.each([0, -1])(
    '版番号が1未満(%i)なら引数の検証の失敗として版番号の欄の詳細を返す',
    async (versionNumber) => {
      const response = await fetchVersion('TERMS', versionNumber);

      expect(response.status).toBe(200);
      expect(response.data?.legalDocumentVersion).toBeNull();
      expect(response.errors).toHaveLength(1);
      expect(response.errors?.[0]?.extensions?.code).toBe('validation_error');
      expect(response.errors?.[0]?.extensions?.details).toEqual([
        {
          field: 'versionNumber',
          code: 'too_small',
          message: '版番号は1以上の整数で指定してください。',
        },
      ]);
    },
  );
});

describe('legalSchemaModuleの型', () => {
  const schema = composeGatewaySchema([legalSchemaModule]);

  test('公開の型は下書きと管理者の項目を持たない', () => {
    expect(fieldsOf(schema, 'LegalDocument')).toEqual({
      kind: 'LegalDocumentKind!',
      latest: 'LegalDocumentVersion',
      revisions: '[LegalRevision!]!',
    });
    expect(fieldsOf(schema, 'LegalDocumentVersion')).toEqual({
      kind: 'LegalDocumentKind!',
      versionNumber: 'Int!',
      publishedAt: 'DateTime!',
      changeSummary: 'String!',
      body: 'String!',
      isLatest: 'Boolean!',
    });
    expect(fieldsOf(schema, 'LegalRevision')).toEqual({
      versionNumber: 'Int!',
      publishedAt: 'DateTime!',
      changeSummary: 'String!',
    });
  });

  test('公開の照会は種類と版番号だけを受け取る', () => {
    const query = schema.getQueryType()?.getFields();

    expect(String(query?.['legalDocument']?.type)).toBe('LegalDocument!');
    expect(
      query?.['legalDocument']?.args.map((arg) => [arg.name, String(arg.type)]),
    ).toEqual([['kind', 'LegalDocumentKind!']]);
    expect(String(query?.['legalDocumentVersion']?.type)).toBe(
      'LegalDocumentVersion',
    );
    expect(
      query?.['legalDocumentVersion']?.args.map((arg) => [
        arg.name,
        String(arg.type),
      ]),
    ).toEqual([
      ['kind', 'LegalDocumentKind!'],
      ['versionNumber', 'Int!'],
    ]);
  });

  test('種類の列挙型は3つの文書の値を持つ', () => {
    const kind = schema.getType('LegalDocumentKind');

    expect(isEnumType(kind)).toBe(true);
    expect(
      isEnumType(kind) ? kind.getValues().map(({ name }) => name) : [],
    ).toEqual(['TERMS', 'PRIVACY', 'LEGAL_NOTICE']);
  });

  test('管理の型と入力型を設計どおりの項目で持つ', () => {
    expect(fieldsOf(schema, 'LegalDocumentEditor')).toEqual({
      id: 'ID!',
      nickname: 'String',
    });
    expect(fieldsOf(schema, 'AdminLegalRevision')).toEqual({
      versionNumber: 'Int!',
      publishedAt: 'DateTime!',
      changeSummary: 'String!',
      publishedBy: 'LegalDocumentEditor!',
    });
    expect(fieldsOf(schema, 'AdminLegalDraft')).toEqual({
      body: 'String!',
      savedAt: 'DateTime!',
      savedBy: 'LegalDocumentEditor!',
    });
    expect(fieldsOf(schema, 'AdminLegalDocumentSummary')).toEqual({
      kind: 'LegalDocumentKind!',
      latestVersionNumber: 'Int',
      latestPublishedAt: 'DateTime',
      hasDraft: 'Boolean!',
    });
    expect(fieldsOf(schema, 'AdminLegalDocument')).toEqual({
      kind: 'LegalDocumentKind!',
      stateVersion: 'Int!',
      latestBody: 'String',
      draft: 'AdminLegalDraft',
      revisions: '[AdminLegalRevision!]!',
    });
    expect(fieldsOf(schema, 'AdminLegalDocumentVersion')).toEqual({
      kind: 'LegalDocumentKind!',
      versionNumber: 'Int!',
      publishedAt: 'DateTime!',
      changeSummary: 'String!',
      body: 'String!',
      isLatest: 'Boolean!',
      publishedBy: 'LegalDocumentEditor!',
    });
    expect(fieldsOf(schema, 'SaveLegalDocumentDraftInput')).toEqual({
      kind: 'LegalDocumentKind!',
      expectedStateVersion: 'Int!',
      body: 'String!',
    });
    expect(fieldsOf(schema, 'DiscardLegalDocumentDraftInput')).toEqual({
      kind: 'LegalDocumentKind!',
      expectedStateVersion: 'Int!',
    });
    expect(fieldsOf(schema, 'PublishLegalDocumentInput')).toEqual({
      kind: 'LegalDocumentKind!',
      expectedStateVersion: 'Int!',
      changeSummary: 'String!',
    });
  });
});
