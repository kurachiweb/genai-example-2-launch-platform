import { InfoIcon } from 'lucide-react';

import { INLINE_LINK_CLASS_NAME } from '../../../lib/components/navigation/inline-link-class.ts';
import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import {
  LEGAL_DOCUMENT_PATHS,
  type LegalDocumentKind,
} from '../../../common-lib/legal/legal-documents.ts';
import {
  LATEST_VERSION_NOTICE,
  pastVersionNotice,
  VIEW_LATEST_VERSION_LABEL,
  VIEW_PUBLIC_PAGE_LABEL,
} from './legal-messages.ts';

export interface LegalVersionNoticeProps {
  readonly kind: LegalDocumentKind;
  readonly isLatest: boolean;
  readonly versionNumber: number;
}

// 版のページは公開ページのパスの下にあり、既定の判定では公開ページへのリンクが現在のページと示されてしまう
const PUBLIC_PAGE_ACTIVE_OPTIONS = { exact: true } as const;

export function LegalVersionNotice({
  kind,
  isLatest,
  versionNumber,
}: LegalVersionNoticeProps) {
  return (
    <div
      role="note"
      className="mt-6 flex gap-2 rounded-lg border border-border bg-muted p-4 text-sm"
    >
      <InfoIcon
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
      />
      <p className="flex flex-wrap gap-x-3 gap-y-1">
        <span>
          {isLatest ? LATEST_VERSION_NOTICE : pastVersionNotice(versionNumber)}
        </span>
        <PathLink
          href={LEGAL_DOCUMENT_PATHS[kind]}
          activeOptions={PUBLIC_PAGE_ACTIVE_OPTIONS}
          className={INLINE_LINK_CLASS_NAME}
        >
          {isLatest ? VIEW_PUBLIC_PAGE_LABEL : VIEW_LATEST_VERSION_LABEL}
        </PathLink>
      </p>
    </div>
  );
}
