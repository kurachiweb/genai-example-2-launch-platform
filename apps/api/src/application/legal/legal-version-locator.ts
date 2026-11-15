import { inject, injectable } from 'inversify';

import type { LegalDocumentKind } from '../../../common-lib/legal/legal-documents.ts';
import { LEGAL_TYPES } from './legal-types.ts';
import type {
  LegalDocumentStore,
  LegalPublishedVersionLocation,
} from './ports.ts';

export interface LegalVersionLocator {
  // at以前(同じミリ秒を含む)で公開日時が最も新しい版
  findPublishedAt(
    kind: LegalDocumentKind,
    at: Date,
  ): Promise<LegalPublishedVersionLocation | undefined>;
}

@injectable()
export class StoreLegalVersionLocator implements LegalVersionLocator {
  constructor(
    @inject(LEGAL_TYPES.LegalDocumentStore)
    private readonly store: LegalDocumentStore,
  ) {}

  async findPublishedAt(
    kind: LegalDocumentKind,
    at: Date,
  ): Promise<LegalPublishedVersionLocation | undefined> {
    const location = await this.store.findPublishedAt(kind, at);
    return location === undefined
      ? undefined
      : {
          versionNumber: location.versionNumber,
          publishedAt: location.publishedAt,
        };
  }
}
