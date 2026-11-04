import { inject, injectable } from 'inversify';

import type { LegalDocumentKind } from '../../../common-lib/legal/legal-documents.ts';
import { LEGAL_TYPES } from './legal-types.ts';
import type {
  LegalDocumentStore,
  LegalRevisionRecord,
  LegalVersionRecord,
} from './ports.ts';

export interface PublicLegalVersion {
  readonly kind: LegalDocumentKind;
  readonly versionNumber: number;
  readonly publishedAt: Date;
  readonly changeSummary: string;
  readonly body: string;
  readonly isLatest: boolean;
}

export interface PublicLegalRevision {
  readonly versionNumber: number;
  readonly publishedAt: Date;
  readonly changeSummary: string;
}

export interface PublicLegalDocument {
  readonly kind: LegalDocumentKind;
  // nullは準備中
  readonly latest: PublicLegalVersion | null;
  // 新しい順
  readonly revisions: readonly PublicLegalRevision[];
}

export interface LegalDocumentReader {
  getDocument(kind: LegalDocumentKind): Promise<PublicLegalDocument>;
  getVersion(
    kind: LegalDocumentKind,
    versionNumber: number,
  ): Promise<PublicLegalVersion | undefined>;
}

export const toPublicLegalRevision = (
  record: LegalRevisionRecord,
): PublicLegalRevision => ({
  versionNumber: record.versionNumber,
  publishedAt: record.publishedAt,
  changeSummary: record.changeSummary,
});

export const toPublicLegalVersion = (
  kind: LegalDocumentKind,
  record: LegalVersionRecord,
): PublicLegalVersion => ({
  kind,
  versionNumber: record.versionNumber,
  publishedAt: record.publishedAt,
  changeSummary: record.changeSummary,
  body: record.body,
  isLatest: record.versionNumber === record.latestVersionNumber,
});

@injectable()
export class StoreLegalDocumentReader implements LegalDocumentReader {
  constructor(
    @inject(LEGAL_TYPES.LegalDocumentStore)
    private readonly store: LegalDocumentStore,
  ) {}

  async getDocument(kind: LegalDocumentKind): Promise<PublicLegalDocument> {
    const { latest } = await this.store.findState(kind);
    if (latest === null) {
      return { kind, latest: null, revisions: [] };
    }
    // 版は追記だけで変わらないため、状態の後に読んだ改訂履歴を状態の最新版までに絞れば、照会の間に公開されても同じ時点の結果に揃う
    const revisions = (await this.store.listRevisions(kind))
      .filter((revision) => revision.versionNumber <= latest.versionNumber)
      .map(toPublicLegalRevision);
    const latestRevision = revisions.find(
      (revision) => revision.versionNumber === latest.versionNumber,
    );
    if (latestRevision === undefined) {
      throw new Error(
        `法務文書の最新版の改訂履歴がありません: ${kind} ${String(latest.versionNumber)}`,
      );
    }
    return {
      kind,
      latest: {
        kind,
        versionNumber: latest.versionNumber,
        publishedAt: latest.publishedAt,
        changeSummary: latestRevision.changeSummary,
        body: latest.body,
        isLatest: true,
      },
      revisions,
    };
  }

  async getVersion(
    kind: LegalDocumentKind,
    versionNumber: number,
  ): Promise<PublicLegalVersion | undefined> {
    const record = await this.store.findVersion(kind, versionNumber);
    return record === undefined
      ? undefined
      : toPublicLegalVersion(kind, record);
  }
}
