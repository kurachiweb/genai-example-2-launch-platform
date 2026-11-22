import type { RefObject } from 'react';

import { EmailVerificationNotice } from '../auth/email-verification-notice.tsx';
import { DataExportList } from './data-export-list.tsx';
import {
  DATA_EXPORT_DESCRIPTION,
  DATA_EXPORT_EMAIL_NOT_VERIFIED_MESSAGE,
  DATA_EXPORT_RULES_DESCRIPTION,
} from './data-export-messages.ts';
import { DataExportRequestButton } from './data-export-request-button.tsx';

export interface DataExportPanelProps {
  readonly viewerId: string;
  readonly emailVerified: boolean;
  // 一覧の名前にするページの見出し
  readonly labelledBy: string;
  // 再試行で消える再試行のボタンから、フォーカスを<body>へ落とさないための移り先
  readonly retryFocusRef: RefObject<HTMLElement | null>;
}

// ページの見出しの下に、説明・要求の操作・自分の要求の一覧を順に置く
export function DataExportPanel({
  viewerId,
  emailVerified,
  labelledBy,
  retryFocusRef,
}: DataExportPanelProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 text-sm text-muted-foreground">
        <p>{DATA_EXPORT_DESCRIPTION}</p>
        <p>{DATA_EXPORT_RULES_DESCRIPTION}</p>
      </div>
      {emailVerified ? null : (
        <EmailVerificationNotice
          message={DATA_EXPORT_EMAIL_NOT_VERIFIED_MESSAGE}
        />
      )}
      <DataExportRequestButton disabled={!emailVerified} />
      <DataExportList
        viewerId={viewerId}
        labelledBy={labelledBy}
        retryFocusRef={retryFocusRef}
      />
    </div>
  );
}
