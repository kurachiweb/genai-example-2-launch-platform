import { DateTime } from '../../../lib/components/datetime/date-time.tsx';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { RETRY_AT_SUFFIX } from './inquiry-contact-messages.ts';
import type { InquirySubmitErrorView } from './inquiry-submit-error.ts';

export interface InquirySubmitErrorMessageProps {
  readonly error: InquirySubmitErrorView;
}

export function InquirySubmitErrorMessage({
  error: { message, retryAt },
}: InquirySubmitErrorMessageProps) {
  return (
    <FormMessage role="alert">
      {message}
      {retryAt === undefined ? null : (
        <>
          <DateTime value={retryAt} format="dateTime" />
          {RETRY_AT_SUFFIX}
        </>
      )}
    </FormMessage>
  );
}
