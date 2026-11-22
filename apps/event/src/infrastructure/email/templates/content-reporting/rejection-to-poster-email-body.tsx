import { Text } from '@react-email/components';
import type { ReactNode } from 'react';

import type { ReportRejectionToPosterInput } from '../../../../../lib/core/email/kinds/content-reporting.ts';
import { ReportDatedText } from './report-dated-text.tsx';
import { ReportMultilineText } from './report-multiline-text.tsx';
import {
  POSTER_CLOSING,
  posterRejectionLead,
  shownExcerpt,
} from './report-notice-copy.ts';

interface RejectionToPosterEmailBodyProps {
  readonly input: ReportRejectionToPosterInput;
}

export function RejectionToPosterEmailBody({
  input,
}: RejectionToPosterEmailBodyProps): ReactNode {
  const excerpt = shownExcerpt(input);
  return (
    <>
      <Text>{posterRejectionLead(input)}</Text>
      {excerpt !== null && (
        <ReportMultilineText label="コメント" value={excerpt} />
      )}
      <ReportDatedText label="却下の日時" at={input.decidedAt} />
      <ReportMultilineText label="理由" value={input.reason} />
      <Text>{POSTER_CLOSING}</Text>
    </>
  );
}
