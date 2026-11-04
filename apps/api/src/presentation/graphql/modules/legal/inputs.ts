import { z } from 'zod';

import { INPUT_MESSAGES } from './errors.ts';
import { legalDocumentKindOf } from './mappers.ts';

const kind = z
  .enum(['TERMS', 'PRIVACY', 'LEGAL_NOTICE'])
  .transform(legalDocumentKindOf);

const versionNumber = z.int().min(1, INPUT_MESSAGES.versionNumberTooSmall);

export const LEGAL_DOCUMENT_ARGS = z.object({ kind });

export const LEGAL_DOCUMENT_VERSION_ARGS = z.object({ kind, versionNumber });
