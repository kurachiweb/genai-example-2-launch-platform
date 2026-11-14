import { z } from 'zod';

import {
  changeSummarySchema,
  legalBodySchema,
} from '../../../../../common-lib/legal/legal-input-rules.ts';
import { INPUT_MESSAGES } from './errors.ts';
import { legalDocumentKindOf } from './mappers.ts';

const kind = z
  .enum(['TERMS', 'PRIVACY', 'LEGAL_NOTICE'])
  .transform(legalDocumentKindOf);

const versionNumber = z.int().min(1, INPUT_MESSAGES.versionNumberTooSmall);

const expectedStateVersion = z
  .int()
  .min(0, INPUT_MESSAGES.expectedStateVersionTooSmall);

export const LEGAL_DOCUMENT_ARGS = z.object({ kind });

export const LEGAL_DOCUMENT_VERSION_ARGS = z.object({ kind, versionNumber });

export const SAVE_LEGAL_DOCUMENT_DRAFT_ARGS = z.object({
  input: z.object({ kind, expectedStateVersion, body: legalBodySchema() }),
});

export const DISCARD_LEGAL_DOCUMENT_DRAFT_ARGS = z.object({
  input: z.object({ kind, expectedStateVersion }),
});

// 変更概要は前後の空白を除いた値でユースケースへ渡す
export const PUBLISH_LEGAL_DOCUMENT_ARGS = z.object({
  input: z.object({
    kind,
    expectedStateVersion,
    changeSummary: changeSummarySchema(),
  }),
});
