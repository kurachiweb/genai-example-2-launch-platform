import { inject, injectable } from 'inversify';

import type { LegalDocumentKind } from '../../../common-lib/legal/legal-documents.ts';
import { ADMIN_PLATFORM_TYPES } from '../../../lib/core/admin/identifiers.ts';
import type {
  AdminDirectory,
  AdminProfileView,
} from '../../../lib/core/admin/ports.ts';
import {
  type PublicLegalRevision,
  type PublicLegalVersion,
  toPublicLegalRevision,
  toPublicLegalVersion,
} from './legal-document-reader.ts';
import { LEGAL_TYPES } from './legal-types.ts';
import type {
  LegalDocumentStore,
  LegalDocumentSummaryRecord,
  LegalRevisionRecord,
} from './ports.ts';

export interface LegalEditorView {
  readonly id: string;
  // nullは削除済み
  readonly nickname: string | null;
}

export interface AdminLegalDraftView {
  readonly body: string;
  readonly savedAt: Date;
  readonly savedBy: LegalEditorView;
}

export interface AdminLegalRevisionView extends PublicLegalRevision {
  readonly publishedBy: LegalEditorView;
}

export interface AdminLegalDocumentView {
  readonly kind: LegalDocumentKind;
  readonly stateVersion: number;
  readonly latestBody: string | null;
  readonly draft: AdminLegalDraftView | null;
  // 新しい順
  readonly revisions: readonly AdminLegalRevisionView[];
}

export interface AdminLegalVersionView extends PublicLegalVersion {
  readonly publishedBy: LegalEditorView;
}

export interface LegalDocumentAdminReader {
  listDocuments(): Promise<readonly LegalDocumentSummaryRecord[]>;
  getDocument(kind: LegalDocumentKind): Promise<AdminLegalDocumentView>;
  getVersion(
    kind: LegalDocumentKind,
    versionNumber: number,
  ): Promise<AdminLegalVersionView | undefined>;
}

const toEditorView = (
  id: string,
  profiles: ReadonlyMap<string, AdminProfileView>,
): LegalEditorView => ({ id, nickname: profiles.get(id)?.nickname ?? null });

@injectable()
export class StoreLegalDocumentAdminReader implements LegalDocumentAdminReader {
  constructor(
    @inject(LEGAL_TYPES.LegalDocumentStore)
    private readonly store: LegalDocumentStore,
    @inject(ADMIN_PLATFORM_TYPES.AdminDirectory)
    private readonly directory: AdminDirectory,
  ) {}

  listDocuments(): Promise<readonly LegalDocumentSummaryRecord[]> {
    return this.store.listSummaries();
  }

  async getDocument(kind: LegalDocumentKind): Promise<AdminLegalDocumentView> {
    const { stateVersion, latest, draft } = await this.store.findState(kind);
    // 版は追記だけで変わらないため、状態の後に読んだ改訂履歴を状態の最新版までに絞れば、照会の間に公開されても状態の版と同じ時点に揃う
    const revisions: readonly LegalRevisionRecord[] =
      latest === null
        ? []
        : (await this.store.listRevisions(kind)).filter(
            (revision) => revision.versionNumber <= latest.versionNumber,
          );
    const profiles = await this.findProfiles([
      ...revisions.map((revision) => revision.publishedByAdminId),
      ...(draft === null ? [] : [draft.savedByAdminId]),
    ]);
    return {
      kind,
      stateVersion,
      latestBody: latest?.body ?? null,
      draft:
        draft === null
          ? null
          : {
              body: draft.body,
              savedAt: draft.savedAt,
              savedBy: toEditorView(draft.savedByAdminId, profiles),
            },
      revisions: revisions.map((revision) => ({
        ...toPublicLegalRevision(revision),
        publishedBy: toEditorView(revision.publishedByAdminId, profiles),
      })),
    };
  }

  async getVersion(
    kind: LegalDocumentKind,
    versionNumber: number,
  ): Promise<AdminLegalVersionView | undefined> {
    const record = await this.store.findVersion(kind, versionNumber);
    if (record === undefined) {
      return undefined;
    }
    const profiles = await this.findProfiles([record.publishedByAdminId]);
    return {
      ...toPublicLegalVersion(kind, record),
      publishedBy: toEditorView(record.publishedByAdminId, profiles),
    };
  }

  private async findProfiles(
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, AdminProfileView>> {
    const uniqueIds = [...new Set(ids)];
    return uniqueIds.length === 0
      ? new Map()
      : this.directory.findProfiles(uniqueIds);
  }
}
