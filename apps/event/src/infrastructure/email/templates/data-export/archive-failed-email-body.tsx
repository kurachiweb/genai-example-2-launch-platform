import { Link, Text } from '@react-email/components';
import type { ReactNode } from 'react';

import type { DataExportArchiveFailedEmailInput } from '../../../../../lib/core/email/kinds/data-export.ts';
import { DataExportDatedText } from './data-export-dated-text.tsx';
import {
  archiveFailedContactGuide,
  archiveFailedLead,
  EXPORT_PAGE_LINK_LABEL,
  RE_REQUEST_GUIDE,
} from './data-export-email-copy.ts';

interface ArchiveFailedEmailBodyProps {
  readonly input: DataExportArchiveFailedEmailInput;
}

export function ArchiveFailedEmailBody({
  input,
}: ArchiveFailedEmailBodyProps): ReactNode {
  return (
    <>
      <Text>{archiveFailedLead(input.reason)}</Text>
      <DataExportDatedText label="要求日時" at={input.requestedAt} />
      <Text>{RE_REQUEST_GUIDE}</Text>
      <Text>
        <Link href={input.pageUrl}>{EXPORT_PAGE_LINK_LABEL}</Link>
      </Text>
      <Text>{archiveFailedContactGuide(input.reason)}</Text>
    </>
  );
}
