import { Text } from '@react-email/components';
import type { ReactNode } from 'react';

import type { ReportInfringementInquiryInput } from '../../../../../lib/core/email/kinds/content-reporting.ts';
import { ReportDatedText } from './report-dated-text.tsx';
import { ReportMultilineText } from './report-multiline-text.tsx';
import {
  INQUIRY_OVERDUE_NOTICE,
  INQUIRY_REPLY_METHOD,
  infringementInquiryLead,
  shownExcerpt,
} from './report-notice-copy.ts';

interface InfringementInquiryEmailBodyProps {
  readonly input: ReportInfringementInquiryInput;
}

// 対象のページのURLは回答に書き写してもらうため、リンクにせず文字列で示す
export function InfringementInquiryEmailBody({
  input,
}: InfringementInquiryEmailBodyProps): ReactNode {
  const excerpt = shownExcerpt(input);
  return (
    <>
      <Text>{infringementInquiryLead(input)}</Text>
      <ReportMultilineText label="照会の内容" value={input.message} />
      {excerpt !== null && (
        <ReportMultilineText label="コメント" value={excerpt} />
      )}
      <Text>{`対象のページ: ${input.targetUrl}`}</Text>
      <Text>{INQUIRY_REPLY_METHOD}</Text>
      <ReportDatedText label="回答の期限" at={input.deadline} />
      <Text>{INQUIRY_OVERDUE_NOTICE}</Text>
    </>
  );
}
