import { and, desc, eq, isNotNull, lte, sql, type SQL } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import {
  LEGAL_DOCUMENT_KINDS,
  type LegalDocumentKind,
} from '../../../common-lib/legal/legal-documents.ts';
import type { Database } from '../../../db/client.ts';
import { legalDocumentVersions } from '../../../db/schema/legal/legal-document-versions.ts';
import { legalDocuments } from '../../../db/schema/legal/legal-documents.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  LegalDocumentStore,
  LegalDocumentSummaryRecord,
  LegalDraftDiscardInput,
  LegalDraftSaveInput,
  LegalPublishedVersionLocation,
  LegalPublishInput,
  LegalRevisionRecord,
  LegalVersionRecord,
} from '../../application/legal/ports.ts';
import type { LegalDocumentState } from '../../domain/legal/legal-document.ts';

const VERSION_NUMBER_UNIQUE_COLUMNS = new Set([
  'legal_document_versions.document_id',
  'legal_document_versions.version_number',
]);

const UNIQUE_VIOLATION_PATTERN = /UNIQUE constraint failed: ([^:]+)/u;

// 一括の書き込みの失敗はD1のエラーがcauseにSQLiteのエラーを持ち、文の組み立ての失敗はDrizzleQueryErrorが包むため、原因をたどって文言を調べる
function violatesVersionNumberUnique(error: unknown): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    const columns = UNIQUE_VIOLATION_PATTERN.exec(current.message)?.[1];
    if (columns !== undefined) {
      const violated = columns.split(',').map((column) => column.trim());
      return (
        violated.length === VERSION_NUMBER_UNIQUE_COLUMNS.size &&
        violated.every((column) => VERSION_NUMBER_UNIQUE_COLUMNS.has(column))
      );
    }
  }
  return false;
}

function missingDocumentError(kind: LegalDocumentKind): Error {
  return new Error(`法務文書の行がありません: ${kind}`);
}

const latestVersionJoin = and(
  eq(legalDocumentVersions.documentId, legalDocuments.id),
  eq(legalDocumentVersions.versionNumber, legalDocuments.latestVersionNumber),
);

function writableDocument(
  kind: LegalDocumentKind,
  expectedStateVersion: number,
): SQL | undefined {
  return and(
    eq(legalDocuments.kind, kind),
    eq(legalDocuments.stateVersion, expectedStateVersion),
  );
}

function publishableDocument(
  kind: LegalDocumentKind,
  expectedStateVersion: number,
): SQL | undefined {
  return and(
    writableDocument(kind, expectedStateVersion),
    isNotNull(legalDocuments.draftBody),
  );
}

@injectable()
export class D1LegalDocumentStore implements LegalDocumentStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async findState(kind: LegalDocumentKind): Promise<LegalDocumentState> {
    const [row] = await this.db
      .select({
        stateVersion: legalDocuments.stateVersion,
        draftBody: legalDocuments.draftBody,
        draftSavedAt: legalDocuments.draftSavedAt,
        draftSavedByAdminId: legalDocuments.draftSavedByAdminId,
        latestVersionNumber: legalDocumentVersions.versionNumber,
        latestBody: legalDocumentVersions.body,
        latestPublishedAt: legalDocumentVersions.publishedAt,
      })
      .from(legalDocuments)
      .leftJoin(legalDocumentVersions, latestVersionJoin)
      .where(eq(legalDocuments.kind, kind));
    if (row === undefined) {
      throw missingDocumentError(kind);
    }
    return {
      kind,
      stateVersion: row.stateVersion,
      latest:
        row.latestVersionNumber === null ||
        row.latestBody === null ||
        row.latestPublishedAt === null
          ? null
          : {
              versionNumber: row.latestVersionNumber,
              body: row.latestBody,
              publishedAt: row.latestPublishedAt,
            },
      draft:
        row.draftBody === null ||
        row.draftSavedAt === null ||
        row.draftSavedByAdminId === null
          ? null
          : {
              body: row.draftBody,
              savedAt: row.draftSavedAt,
              savedByAdminId: row.draftSavedByAdminId,
            },
    };
  }

  async listSummaries(): Promise<readonly LegalDocumentSummaryRecord[]> {
    const rows = await this.db
      .select({
        kind: legalDocuments.kind,
        latestVersionNumber: legalDocumentVersions.versionNumber,
        latestPublishedAt: legalDocumentVersions.publishedAt,
        hasDraft: sql<number>`${legalDocuments.draftBody} IS NOT NULL`,
      })
      .from(legalDocuments)
      .leftJoin(legalDocumentVersions, latestVersionJoin);
    return LEGAL_DOCUMENT_KINDS.map((kind) => {
      const row = rows.find((candidate) => candidate.kind === kind);
      if (row === undefined) {
        throw missingDocumentError(kind);
      }
      return {
        kind,
        latestVersionNumber: row.latestVersionNumber,
        latestPublishedAt: row.latestPublishedAt,
        hasDraft: row.hasDraft === 1,
      };
    });
  }

  async listRevisions(
    kind: LegalDocumentKind,
  ): Promise<readonly LegalRevisionRecord[]> {
    return this.db
      .select({
        versionNumber: legalDocumentVersions.versionNumber,
        publishedAt: legalDocumentVersions.publishedAt,
        changeSummary: legalDocumentVersions.changeSummary,
        publishedByAdminId: legalDocumentVersions.publishedByAdminId,
      })
      .from(legalDocumentVersions)
      .innerJoin(
        legalDocuments,
        eq(legalDocumentVersions.documentId, legalDocuments.id),
      )
      .where(eq(legalDocuments.kind, kind))
      .orderBy(desc(legalDocumentVersions.versionNumber));
  }

  async findVersion(
    kind: LegalDocumentKind,
    versionNumber: number,
  ): Promise<LegalVersionRecord | undefined> {
    const [row] = await this.db
      .select({
        versionNumber: legalDocumentVersions.versionNumber,
        publishedAt: legalDocumentVersions.publishedAt,
        changeSummary: legalDocumentVersions.changeSummary,
        publishedByAdminId: legalDocumentVersions.publishedByAdminId,
        body: legalDocumentVersions.body,
        latestVersionNumber: legalDocuments.latestVersionNumber,
      })
      .from(legalDocumentVersions)
      .innerJoin(
        legalDocuments,
        eq(legalDocumentVersions.documentId, legalDocuments.id),
      )
      .where(
        and(
          eq(legalDocuments.kind, kind),
          eq(legalDocumentVersions.versionNumber, versionNumber),
        ),
      );
    return row;
  }

  async findPublishedAt(
    kind: LegalDocumentKind,
    at: Date,
  ): Promise<LegalPublishedVersionLocation | undefined> {
    const [row] = await this.db
      .select({
        versionNumber: legalDocumentVersions.versionNumber,
        publishedAt: legalDocumentVersions.publishedAt,
      })
      .from(legalDocumentVersions)
      .innerJoin(
        legalDocuments,
        eq(legalDocumentVersions.documentId, legalDocuments.id),
      )
      .where(
        and(
          eq(legalDocuments.kind, kind),
          lte(legalDocumentVersions.publishedAt, at),
        ),
      )
      .orderBy(
        desc(legalDocumentVersions.publishedAt),
        desc(legalDocumentVersions.versionNumber),
      )
      .limit(1);
    return row;
  }

  async saveDraft(input: LegalDraftSaveInput): Promise<'saved' | 'conflict'> {
    const result = await this.db
      .update(legalDocuments)
      .set({
        draftBody: input.body,
        draftSavedAt: input.savedAt,
        draftSavedByAdminId: input.savedByAdminId,
        stateVersion: sql`${legalDocuments.stateVersion} + 1`,
        updatedAt: input.savedAt,
      })
      .where(writableDocument(input.kind, input.expectedStateVersion));
    return result.meta.changes > 0 ? 'saved' : 'conflict';
  }

  async discardDraft(
    input: LegalDraftDiscardInput,
  ): Promise<'discarded' | 'conflict'> {
    const result = await this.db
      .update(legalDocuments)
      .set({
        draftBody: null,
        draftSavedAt: null,
        draftSavedByAdminId: null,
        stateVersion: sql`${legalDocuments.stateVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(publishableDocument(input.kind, input.expectedStateVersion));
    return result.meta.changes > 0 ? 'discarded' : 'conflict';
  }

  // 一括の書き込みの中では前の文の結果で後の文を分けられないため、版の挿入と文書の行の更新に同じ条件を付け、
  // 版の挿入を先に置いて、文書の行を書き換える前の状態で両方の条件を判定させる
  async publish(input: LegalPublishInput): Promise<'published' | 'conflict'> {
    const condition = publishableDocument(
      input.kind,
      input.expectedStateVersion,
    );
    const publishedAtMs = input.publishedAt.getTime();
    try {
      const [inserted] = await this.db.batch([
        this.db.insert(legalDocumentVersions).select(
          this.db
            .select({
              id: sql<string>`${input.versionId}`.as('id'),
              documentId: legalDocuments.id,
              versionNumber:
                sql<number>`${legalDocuments.latestVersionNumber} + 1`.as(
                  'version_number',
                ),
              body: sql<string>`${legalDocuments.draftBody}`.as('body'),
              changeSummary: sql<string>`${input.changeSummary}`.as(
                'change_summary',
              ),
              publishedAt: sql<number>`${publishedAtMs}`.as('published_at'),
              publishedByAdminId: sql<string>`${input.publishedByAdminId}`.as(
                'published_by_admin_id',
              ),
              createdAt: sql<number>`${publishedAtMs}`.as('created_at'),
              updatedAt: sql<number>`${publishedAtMs}`.as('updated_at'),
            })
            .from(legalDocuments)
            .where(condition),
        ),
        this.db
          .update(legalDocuments)
          .set({
            latestVersionNumber: sql`${legalDocuments.latestVersionNumber} + 1`,
            draftBody: null,
            draftSavedAt: null,
            draftSavedByAdminId: null,
            stateVersion: sql`${legalDocuments.stateVersion} + 1`,
            updatedAt: input.publishedAt,
          })
          .where(condition),
      ]);
      return inserted.meta.changes > 0 ? 'published' : 'conflict';
    } catch (error) {
      if (violatesVersionNumberUnique(error)) {
        return 'conflict';
      }
      throw error;
    }
  }
}
