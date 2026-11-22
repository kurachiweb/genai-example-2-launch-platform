import { Text } from '@react-email/components';
import type { ReactNode } from 'react';

import type { ReportOutcomeInput } from '../../../../../lib/core/email/kinds/content-reporting.ts';
import { ReportDatedText } from './report-dated-text.tsx';
import { ReportMultilineText } from './report-multiline-text.tsx';
import {
  REPORTER_CLOSING,
  reportOutcomeDateLabel,
  reportOutcomeLead,
  shownExcerpt,
} from './report-notice-copy.ts';

interface ReportOutcomeEmailBodyProps {
  readonly input: ReportOutcomeInput;
}

export function ReportOutcomeEmailBody({
  input,
}: ReportOutcomeEmailBodyProps): ReactNode {
  const excerpt = shownExcerpt(input);
  return (
    <>
      <Text>{reportOutcomeLead(input.outcome, input)}</Text>
      {excerpt !== null && (
        <ReportMultilineText label="コメント" value={excerpt} />
      )}
      <ReportDatedText
        label={reportOutcomeDateLabel(input.outcome)}
        at={input.decidedAt}
      />
      <ReportMultilineText label="理由" value={input.reason} />
      <Text>{REPORTER_CLOSING}</Text>
    </>
  );
}
