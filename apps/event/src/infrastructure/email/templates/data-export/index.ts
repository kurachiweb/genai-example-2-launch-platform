import type { EmailTemplate } from '../../rendering/email-template.ts';
import { DATA_EXPORT_ARCHIVE_FAILED_TEMPLATE } from './archive-failed-template.ts';
import { DATA_EXPORT_ARCHIVE_READY_TEMPLATE } from './archive-ready-template.ts';

export const DATA_EXPORT_EMAIL_TEMPLATES: readonly EmailTemplate<unknown>[] =
  Object.freeze([
    DATA_EXPORT_ARCHIVE_READY_TEMPLATE,
    DATA_EXPORT_ARCHIVE_FAILED_TEMPLATE,
  ]);
