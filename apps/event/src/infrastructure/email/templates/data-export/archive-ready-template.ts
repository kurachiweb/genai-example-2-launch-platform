import { DATA_EXPORT_ARCHIVE_READY_EMAIL } from '../../../../../lib/core/email/kinds/data-export.ts';
import { defineEmailTemplate } from '../../rendering/email-template.ts';
import { ArchiveReadyEmailBody } from './archive-ready-email-body.tsx';
import {
  ARCHIVE_READY_LEAD,
  ARCHIVE_READY_SUBJECT,
  DOWNLOAD_PAGE_ACTION_LABEL,
} from './data-export-email-copy.ts';

export const DATA_EXPORT_ARCHIVE_READY_TEMPLATE = defineEmailTemplate({
  kind: DATA_EXPORT_ARCHIVE_READY_EMAIL,
  subject: () => ARCHIVE_READY_SUBJECT,
  preview: () => ARCHIVE_READY_LEAD,
  greeting: (input) => input.nickname,
  action: (input) => ({
    label: DOWNLOAD_PAGE_ACTION_LABEL,
    url: input.pageUrl,
  }),
  Body: ArchiveReadyEmailBody,
});
