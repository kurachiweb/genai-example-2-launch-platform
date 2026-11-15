import { inject, injectable } from 'inversify';

import type { LegalDocumentKind } from '../../../common-lib/legal/legal-documents.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import {
  checkPublishable,
  nextPublishedAt,
  nextVersionNumber,
  type LegalDocumentState,
} from '../../domain/legal/legal-document.ts';
import type {
  AdminLegalDocumentView,
  LegalDocumentAdminReader,
} from './legal-document-admin-reader.ts';
import {
  legalDocumentDenialError,
  legalDocumentError,
} from './legal-document-errors.ts';
import { LEGAL_TYPES } from './legal-types.ts';
import type { LegalDocumentStore } from './ports.ts';

export interface LegalPublishRequest {
  readonly adminId: string;
  readonly kind: LegalDocumentKind;
  readonly expectedStateVersion: number;
  // リゾルバが入力の規則で確かめ、前後の空白を除いた値
  readonly changeSummary: string;
}

export interface LegalDocumentPublisher {
  publish(input: LegalPublishRequest): Promise<AdminLegalDocumentView>;
}

const logger = getAppLogger(['api', 'legal', 'publish']);

const logPublishResult = (
  adminId: string,
  state: LegalDocumentState,
  conflict: boolean,
): void => {
  logger.info(
    conflict
      ? '法務文書の公開を競合のため拒否しました'
      : '法務文書を公開しました',
    {
      action: 'publish',
      kind: state.kind,
      versionNumber: nextVersionNumber(state),
      adminId,
      conflict,
    },
  );
};

@injectable()
export class StoreLegalDocumentPublisher implements LegalDocumentPublisher {
  constructor(
    @inject(LEGAL_TYPES.LegalDocumentStore)
    private readonly store: LegalDocumentStore,
    @inject(LEGAL_TYPES.LegalDocumentAdminReader)
    private readonly adminReader: LegalDocumentAdminReader,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
    @inject(PLATFORM_TYPES.IdGenerator)
    private readonly idGenerator: IdGenerator,
  ) {}

  async publish(input: LegalPublishRequest): Promise<AdminLegalDocumentView> {
    const state = await this.store.findState(input.kind);
    const denial = checkPublishable(state, input.expectedStateVersion);
    if (denial !== undefined) {
      if (denial === 'stale') {
        logPublishResult(input.adminId, state, true);
      }
      throw legalDocumentDenialError(denial);
    }
    const result = await this.store.publish({
      kind: input.kind,
      expectedStateVersion: input.expectedStateVersion,
      versionId: this.idGenerator.generate(),
      changeSummary: input.changeSummary,
      publishedAt: nextPublishedAt(
        this.clock.now(),
        state.latest?.publishedAt ?? null,
      ),
      publishedByAdminId: input.adminId,
    });
    logPublishResult(input.adminId, state, result === 'conflict');
    if (result === 'conflict') {
      throw legalDocumentError('legal_document_conflict');
    }
    return this.adminReader.getDocument(input.kind);
  }
}
