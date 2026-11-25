import { DATA_EXPORT_ARCHIVE_FAILED_EMAIL } from '../../../../../lib/core/email/kinds/data-export.ts';
import { defineEmailTemplate } from '../../rendering/email-template.ts';
import { ArchiveFailedEmailBody } from './archive-failed-email-body.tsx';
import {
  ARCHIVE_FAILED_SUBJECT,
  archiveFailedLead,
  CONTACT_ACTION_LABEL,
} from './data-export-email-copy.ts';

export const DATA_EXPORT_ARCHIVE_FAILED_TEMPLATE = defineEmailTemplate({
  kind: DATA_EXPORT_ARCHIVE_FAILED_EMAIL,
  subject: () => ARCHIVE_FAILED_SUBJECT,
  preview: (input) => archiveFailedLead(input.reason),
  greeting: (input) => input.nickname,
  action: (input) => ({ label: CONTACT_ACTION_LABEL, url: input.contactUrl }),
  Body: ArchiveFailedEmailBody,
});
