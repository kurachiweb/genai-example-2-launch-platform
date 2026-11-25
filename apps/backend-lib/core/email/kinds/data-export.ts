import { z } from 'zod';

import { DATA_EXPORT_FAILURE_KINDS } from '../../../../common-lib/data-export/data-export-rules.ts';
import { type AnyEmailKind, defineEmailKind } from '../email-kind.ts';
import { linkUrlSchema as linkUrl } from './link-url.ts';

const text = z.string().min(1);

const utcDateTime = z.iso.datetime();

const archiveReadyInput = z.object({
  nickname: text,
  requestedAt: utcDateTime,
  expiresAt: utcDateTime,
  pageUrl: linkUrl,
});

const archiveFailedInput = z.object({
  nickname: text,
  requestedAt: utcDateTime,
  reason: z.enum(DATA_EXPORT_FAILURE_KINDS),
  pageUrl: linkUrl,
  contactUrl: linkUrl,
});

export type DataExportArchiveReadyEmailInput = z.infer<
  typeof archiveReadyInput
>;

export type DataExportArchiveFailedEmailInput = z.infer<
  typeof archiveFailedInput
>;

export const DATA_EXPORT_ARCHIVE_READY_EMAIL = defineEmailKind({
  name: 'data-export.archive-ready',
  category: 'transactional',
  inputSchema: archiveReadyInput,
});

export const DATA_EXPORT_ARCHIVE_FAILED_EMAIL = defineEmailKind({
  name: 'data-export.archive-failed',
  category: 'transactional',
  inputSchema: archiveFailedInput,
});

export const DATA_EXPORT_EMAIL_KINDS: readonly AnyEmailKind[] = Object.freeze([
  DATA_EXPORT_ARCHIVE_READY_EMAIL,
  DATA_EXPORT_ARCHIVE_FAILED_EMAIL,
]);
