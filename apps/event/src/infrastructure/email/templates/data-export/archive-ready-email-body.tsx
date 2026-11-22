import { Text } from '@react-email/components';
import type { ReactNode } from 'react';

import type { DataExportArchiveReadyEmailInput } from '../../../../../lib/core/email/kinds/data-export.ts';
import { DataExportDatedText } from './data-export-dated-text.tsx';
import {
  ARCHIVE_READY_GUIDE,
  ARCHIVE_READY_LEAD,
} from './data-export-email-copy.ts';

interface ArchiveReadyEmailBodyProps {
  readonly input: DataExportArchiveReadyEmailInput;
}

export function ArchiveReadyEmailBody({
  input,
}: ArchiveReadyEmailBodyProps): ReactNode {
  return (
    <>
      <Text>{ARCHIVE_READY_LEAD}</Text>
      <DataExportDatedText label="要求日時" at={input.requestedAt} />
      <DataExportDatedText
        label="有効期限"
        at={input.expiresAt}
        suffix="(この日時までダウンロードできます)"
      />
      <Text>{ARCHIVE_READY_GUIDE}</Text>
    </>
  );
}
