import { resetSync } from '@logtape/logtape';
import { afterAll, beforeAll, beforeEach } from 'vitest';

import type { AdminRole } from '../../common-lib/admin/admin-roles.ts';
import type { LegalDocumentKind } from '../../common-lib/legal/legal-documents.ts';
import type {
  AdminLegalDocumentView,
  LegalDocumentAdminReader,
} from '../../src/application/legal/legal-document-admin-reader.ts';
import type { LegalDocumentPublisher } from '../../src/application/legal/legal-document-publisher.ts';
import type { LegalDraftEditor } from '../../src/application/legal/legal-draft-editor.ts';
import { LEGAL_TYPES } from '../../src/application/legal/legal-types.ts';
import {
  adminIdOf,
  clearAdminTables,
  insertAdmin,
} from '../../src/infrastructure/admin/testing/admin-store-fixtures.ts';
import { resetLegalTables } from '../../src/infrastructure/legal/testing/legal-store-fixtures.ts';
import { legalSchemaModule } from '../../src/presentation/graphql/modules/legal/index.ts';
import {
  createAdminGateway,
  createAdminTestContainer,
  issueAdminSession,
} from './admin-graphql-harness.ts';
import { configureRecordingLogs } from './observability-recording.ts';

export interface LegalDocumentEditorFields {
  readonly id: string;
  readonly nickname: string | null;
}

export interface AdminLegalDocumentSummaryFields {
  readonly kind: string;
  readonly latestVersionNumber: number | null;
  readonly latestPublishedAt: string | null;
  readonly hasDraft: boolean;
}

export interface AdminLegalRevisionFields {
  readonly versionNumber: number;
  readonly publishedAt: string;
  readonly changeSummary: string;
  readonly publishedBy: LegalDocumentEditorFields;
}

export interface AdminLegalDocumentFields {
  readonly kind: string;
  readonly stateVersion: number;
  readonly latestBody: string | null;
  readonly draft: {
    readonly body: string;
    readonly savedAt: string;
    readonly savedBy: LegalDocumentEditorFields;
  } | null;
  readonly revisions: readonly AdminLegalRevisionFields[];
}

export interface AdminLegalDocumentVersionFields {
  readonly kind: string;
  readonly versionNumber: number;
  readonly publishedAt: string;
  readonly changeSummary: string;
  readonly body: string;
  readonly isLatest: boolean;
  readonly publishedBy: LegalDocumentEditorFields;
}

const EDITOR_FIELDS = /* GraphQL */ `
  id
  nickname
`;

const ADMIN_LEGAL_DOCUMENT_FIELDS = /* GraphQL */ `
  kind
  stateVersion
  latestBody
  draft {
    body
    savedAt
    savedBy {
      ${EDITOR_FIELDS}
    }
  }
  revisions {
    versionNumber
    publishedAt
    changeSummary
    publishedBy {
      ${EDITOR_FIELDS}
    }
  }
`;

export const ADMIN_LEGAL_DOCUMENTS = /* GraphQL */ `
  query AdminLegalDocuments {
    adminLegalDocuments {
      kind
      latestVersionNumber
      latestPublishedAt
      hasDraft
    }
  }
`;

export const ADMIN_LEGAL_DOCUMENT = /* GraphQL */ `
  query AdminLegalDocument($kind: LegalDocumentKind!) {
    adminLegalDocument(kind: $kind) {
      ${ADMIN_LEGAL_DOCUMENT_FIELDS}
    }
  }
`;

export const ADMIN_LEGAL_DOCUMENT_VERSION = /* GraphQL */ `
  query AdminLegalDocumentVersion(
    $kind: LegalDocumentKind!
    $versionNumber: Int!
  ) {
    adminLegalDocumentVersion(kind: $kind, versionNumber: $versionNumber) {
      kind
      versionNumber
      publishedAt
      changeSummary
      body
      isLatest
      publishedBy {
        ${EDITOR_FIELDS}
      }
    }
  }
`;

export const SAVE_LEGAL_DOCUMENT_DRAFT = /* GraphQL */ `
  mutation AdminSaveLegalDocumentDraft($input: SaveLegalDocumentDraftInput!) {
    saveLegalDocumentDraft(input: $input) {
      ${ADMIN_LEGAL_DOCUMENT_FIELDS}
    }
  }
`;

export const DISCARD_LEGAL_DOCUMENT_DRAFT = /* GraphQL */ `
  mutation AdminDiscardLegalDocumentDraft(
    $input: DiscardLegalDocumentDraftInput!
  ) {
    discardLegalDocumentDraft(input: $input) {
      ${ADMIN_LEGAL_DOCUMENT_FIELDS}
    }
  }
`;

export const PUBLISH_LEGAL_DOCUMENT = /* GraphQL */ `
  mutation AdminPublishLegalDocument($input: PublishLegalDocumentInput!) {
    publishLegalDocument(input: $input) {
      ${ADMIN_LEGAL_DOCUMENT_FIELDS}
    }
  }
`;

export const legalAdminGateway = createAdminGateway({
  documents: [
    ADMIN_LEGAL_DOCUMENTS,
    ADMIN_LEGAL_DOCUMENT,
    ADMIN_LEGAL_DOCUMENT_VERSION,
    SAVE_LEGAL_DOCUMENT_DRAFT,
    DISCARD_LEGAL_DOCUMENT_DRAFT,
    PUBLISH_LEGAL_DOCUMENT,
  ],
  schemaModules: [legalSchemaModule],
});

// 削除済みの管理者は、行を作らずにIDだけを公開者・保存者として使う
export const LEGAL_ADMINS = Object.freeze({
  superAdmin: 1,
  moderator: 2,
  viewer: 3,
  deleted: 9,
});

const ROLES_OF_SIGNED_IN_ADMINS: readonly (readonly [number, AdminRole])[] = [
  [LEGAL_ADMINS.superAdmin, 'super_admin'],
  [LEGAL_ADMINS.moderator, 'moderator'],
  [LEGAL_ADMINS.viewer, 'viewer'],
];

export const RFC3339_UTC_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const sessionTokens = new Map<number, string>();

export function legalAdminSessionOf(adminIndex: number): string {
  const token = sessionTokens.get(adminIndex);
  if (token === undefined) {
    throw new Error(`管理者${String(adminIndex)}のセッションがありません`);
  }
  return token;
}

// 各テストの前に、法務文書を初期データの状態に戻し、3つのロールの管理者とそのセッションを用意する
export function installLegalAdminGraphQLTest(): void {
  beforeAll(() => {
    configureRecordingLogs();
  });

  beforeEach(async () => {
    await clearAdminTables();
    await resetLegalTables();
    sessionTokens.clear();
    for (const [index, role] of ROLES_OF_SIGNED_IN_ADMINS) {
      await insertAdmin(index, { role });
      sessionTokens.set(
        index,
        (await issueAdminSession(adminIdOf(index))).token,
      );
    }
  });

  afterAll(() => {
    resetSync();
  });
}

export function readLegalDocument(
  kind: LegalDocumentKind,
): Promise<AdminLegalDocumentView> {
  return createAdminTestContainer()
    .get<LegalDocumentAdminReader>(LEGAL_TYPES.LegalDocumentAdminReader)
    .getDocument(kind);
}

export async function saveLegalDraftAs(
  adminIndex: number,
  kind: LegalDocumentKind,
  body: string,
): Promise<void> {
  await createAdminTestContainer()
    .get<LegalDraftEditor>(LEGAL_TYPES.LegalDraftEditor)
    .save({
      adminId: adminIdOf(adminIndex),
      kind,
      expectedStateVersion: (await readLegalDocument(kind)).stateVersion,
      body,
    });
}

export async function publishLegalDocumentAs(
  adminIndex: number,
  kind: LegalDocumentKind,
  body: string,
  changeSummary: string,
): Promise<void> {
  await saveLegalDraftAs(adminIndex, kind, body);
  await createAdminTestContainer()
    .get<LegalDocumentPublisher>(LEGAL_TYPES.LegalDocumentPublisher)
    .publish({
      adminId: adminIdOf(adminIndex),
      kind,
      expectedStateVersion: (await readLegalDocument(kind)).stateVersion,
      changeSummary,
    });
}

export function listAdminLegalDocuments(adminIndex: number) {
  return legalAdminGateway.call<{
    adminLegalDocuments: AdminLegalDocumentSummaryFields[] | null;
  }>(
    ADMIN_LEGAL_DOCUMENTS,
    {},
    { sessionToken: legalAdminSessionOf(adminIndex) },
  );
}

export function fetchAdminLegalDocument(adminIndex: number, kind: string) {
  return legalAdminGateway.call<{
    adminLegalDocument: AdminLegalDocumentFields | null;
  }>(
    ADMIN_LEGAL_DOCUMENT,
    { kind },
    { sessionToken: legalAdminSessionOf(adminIndex) },
  );
}

export function fetchAdminLegalDocumentVersion(
  adminIndex: number,
  kind: string,
  versionNumber: number,
) {
  return legalAdminGateway.call<{
    adminLegalDocumentVersion: AdminLegalDocumentVersionFields | null;
  }>(
    ADMIN_LEGAL_DOCUMENT_VERSION,
    { kind, versionNumber },
    { sessionToken: legalAdminSessionOf(adminIndex) },
  );
}

export function saveLegalDocumentDraft(
  adminIndex: number,
  input: Record<string, unknown>,
) {
  return legalAdminGateway.call<{
    saveLegalDocumentDraft: AdminLegalDocumentFields | null;
  }>(
    SAVE_LEGAL_DOCUMENT_DRAFT,
    { input },
    { sessionToken: legalAdminSessionOf(adminIndex) },
  );
}

export function discardLegalDocumentDraft(
  adminIndex: number,
  input: Record<string, unknown>,
) {
  return legalAdminGateway.call<{
    discardLegalDocumentDraft: AdminLegalDocumentFields | null;
  }>(
    DISCARD_LEGAL_DOCUMENT_DRAFT,
    { input },
    { sessionToken: legalAdminSessionOf(adminIndex) },
  );
}

export function publishLegalDocument(
  adminIndex: number,
  input: Record<string, unknown>,
) {
  return legalAdminGateway.call<{
    publishLegalDocument: AdminLegalDocumentFields | null;
  }>(
    PUBLISH_LEGAL_DOCUMENT,
    { input },
    { sessionToken: legalAdminSessionOf(adminIndex) },
  );
}
