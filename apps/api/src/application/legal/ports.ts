import type { LegalDocumentKind } from '../../../common-lib/legal/legal-documents.ts';
import type { LegalDocumentState } from '../../domain/legal/legal-document.ts';

export interface LegalRevisionRecord {
  readonly versionNumber: number;
  readonly publishedAt: Date;
  readonly changeSummary: string;
  readonly publishedByAdminId: string;
}

export interface LegalVersionRecord extends LegalRevisionRecord {
  readonly body: string;
  readonly latestVersionNumber: number;
}

export interface LegalDocumentSummaryRecord {
  readonly kind: LegalDocumentKind;
  readonly latestVersionNumber: number | null;
  readonly latestPublishedAt: Date | null;
  readonly hasDraft: boolean;
}

export interface LegalPublishedVersionLocation {
  readonly versionNumber: number;
  readonly publishedAt: Date;
}

export interface LegalDraftSaveInput {
  readonly kind: LegalDocumentKind;
  readonly expectedStateVersion: number;
  readonly body: string;
  readonly savedAt: Date;
  readonly savedByAdminId: string;
}

export interface LegalDraftDiscardInput {
  readonly kind: LegalDocumentKind;
  readonly expectedStateVersion: number;
}

export interface LegalPublishInput {
  readonly kind: LegalDocumentKind;
  readonly expectedStateVersion: number;
  readonly versionId: string;
  readonly changeSummary: string;
  readonly publishedAt: Date;
  readonly publishedByAdminId: string;
}

export interface LegalDocumentStore {
  // 文書の行は初期データで必ず入るため、行が無ければ例外にする
  findState(kind: LegalDocumentKind): Promise<LegalDocumentState>;
  // LEGAL_DOCUMENT_KINDSの順
  listSummaries(): Promise<readonly LegalDocumentSummaryRecord[]>;
  // 版番号の降順で、本文を含めない
  listRevisions(
    kind: LegalDocumentKind,
  ): Promise<readonly LegalRevisionRecord[]>;
  findVersion(
    kind: LegalDocumentKind,
    versionNumber: number,
  ): Promise<LegalVersionRecord | undefined>;
  // at以前(同じミリ秒を含む)で公開日時が最も新しい版
  findPublishedAt(
    kind: LegalDocumentKind,
    at: Date,
  ): Promise<LegalPublishedVersionLocation | undefined>;
  saveDraft(input: LegalDraftSaveInput): Promise<'saved' | 'conflict'>;
  discardDraft(
    input: LegalDraftDiscardInput,
  ): Promise<'discarded' | 'conflict'>;
  // 本文は下書きの列から、版番号は最新の版番号+1から取る
  publish(input: LegalPublishInput): Promise<'published' | 'conflict'>;
}
