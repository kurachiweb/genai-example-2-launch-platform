import { inject, injectable } from 'inversify';

import type { LegalDocumentKind } from '../../../common-lib/legal/legal-documents.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import {
  checkDraftDiscardable,
  checkDraftWritable,
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

export interface LegalDraftSaveRequest {
  readonly adminId: string;
  readonly kind: LegalDocumentKind;
  readonly expectedStateVersion: number;
  readonly body: string;
}

export interface LegalDraftDiscardRequest {
  readonly adminId: string;
  readonly kind: LegalDocumentKind;
  readonly expectedStateVersion: number;
}

export interface LegalDraftEditor {
  save(input: LegalDraftSaveRequest): Promise<AdminLegalDocumentView>;
  discard(input: LegalDraftDiscardRequest): Promise<AdminLegalDocumentView>;
}

const logger = getAppLogger(['api', 'legal', 'draft']);

const logDraftResult = (
  action: 'save' | 'discard',
  adminId: string,
  state: LegalDocumentState,
  conflict: boolean,
): void => {
  logger.info(
    conflict
      ? '法務文書の下書きの操作を競合のため拒否しました'
      : '法務文書の下書きを操作しました',
    {
      action,
      kind: state.kind,
      latestVersionNumber: state.latest?.versionNumber ?? null,
      adminId,
      conflict,
    },
  );
};

@injectable()
export class StoreLegalDraftEditor implements LegalDraftEditor {
  constructor(
    @inject(LEGAL_TYPES.LegalDocumentStore)
    private readonly store: LegalDocumentStore,
    @inject(LEGAL_TYPES.LegalDocumentAdminReader)
    private readonly adminReader: LegalDocumentAdminReader,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async save(input: LegalDraftSaveRequest): Promise<AdminLegalDocumentView> {
    const state = await this.store.findState(input.kind);
    if (checkDraftWritable(state, input.expectedStateVersion) !== undefined) {
      logDraftResult('save', input.adminId, state, true);
      throw legalDocumentError('legal_document_conflict');
    }
    const result = await this.store.saveDraft({
      kind: input.kind,
      expectedStateVersion: input.expectedStateVersion,
      body: input.body,
      savedAt: this.clock.now(),
      savedByAdminId: input.adminId,
    });
    logDraftResult('save', input.adminId, state, result === 'conflict');
    if (result === 'conflict') {
      throw legalDocumentError('legal_document_conflict');
    }
    return this.adminReader.getDocument(input.kind);
  }

  async discard(
    input: LegalDraftDiscardRequest,
  ): Promise<AdminLegalDocumentView> {
    const state = await this.store.findState(input.kind);
    const denial = checkDraftDiscardable(state, input.expectedStateVersion);
    if (denial !== undefined) {
      if (denial === 'stale') {
        logDraftResult('discard', input.adminId, state, true);
      }
      throw legalDocumentDenialError(denial);
    }
    const result = await this.store.discardDraft({
      kind: input.kind,
      expectedStateVersion: input.expectedStateVersion,
    });
    logDraftResult('discard', input.adminId, state, result === 'conflict');
    if (result === 'conflict') {
      throw legalDocumentError('legal_document_conflict');
    }
    return this.adminReader.getDocument(input.kind);
  }
}
