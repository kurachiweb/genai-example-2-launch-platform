import { LoaderCircleIcon } from 'lucide-react';

import { DateTime } from '../../../lib/components/datetime/date-time.tsx';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import type { DataExportRequestErrorView } from './data-export-errors.ts';
import {
  DATA_EXPORT_RATE_LIMITED_PREFIX,
  DATA_EXPORT_RATE_LIMITED_SUFFIX,
  DATA_EXPORT_REQUEST_LABEL,
  DATA_EXPORT_REQUESTING_LABEL,
} from './data-export-messages.ts';
import { useRequestDataExport } from './use-request-data-export.ts';

export interface DataExportRequestButtonProps {
  // メールアドレスが未確認で要求できない
  readonly disabled: boolean;
}

function RequestErrorMessage({
  error,
}: {
  readonly error: DataExportRequestErrorView;
}) {
  return (
    <FormMessage role="alert">
      {error.kind === 'rate_limited' ? (
        <>
          {DATA_EXPORT_RATE_LIMITED_PREFIX}
          <DateTime value={error.retryAt} format="dateTime" />
          {DATA_EXPORT_RATE_LIMITED_SUFFIX}
        </>
      ) : (
        error.message
      )}
    </FormMessage>
  );
}

// 要求の操作と、失敗の理由。回数の上限の時は、再び要求できる日時を操作の近くに示す
export function DataExportRequestButton({
  disabled,
}: DataExportRequestButtonProps) {
  const { request, pending, error } = useRequestDataExport();

  return (
    <div className="flex flex-col items-start gap-3">
      {/* フォーカスのあるボタンをdisabledにするとフォーカスが失われるため、送信中はaria-disabledで示し、重ねての押下はrequestが無視する */}
      <Button
        type="button"
        disabled={disabled}
        aria-disabled={pending ? true : undefined}
        aria-busy={pending ? true : undefined}
        onClick={request}
      >
        {pending ? (
          <>
            <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
            {DATA_EXPORT_REQUESTING_LABEL}
          </>
        ) : (
          DATA_EXPORT_REQUEST_LABEL
        )}
      </Button>
      {error === undefined ? null : <RequestErrorMessage error={error} />}
    </div>
  );
}
