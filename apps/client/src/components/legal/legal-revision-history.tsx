import { useId } from 'react';

import { DateTime } from '../../../lib/components/datetime/date-time.tsx';
import { INLINE_LINK_CLASS_NAME } from '../../../lib/components/navigation/inline-link-class.ts';
import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import {
  type LegalDocumentKind,
  legalRevisionPath,
  legalVersionLabel,
} from '../../../common-lib/legal/legal-documents.ts';
import { REVISION_HISTORY_TITLE } from './legal-messages.ts';

export interface LegalRevisionSummary {
  readonly versionNumber: number;
  readonly publishedAt: string;
  readonly changeSummary: string;
}

export interface LegalRevisionHistoryProps {
  readonly kind: LegalDocumentKind;
  readonly revisions: readonly LegalRevisionSummary[];
}

export function LegalRevisionHistory({
  kind,
  revisions,
}: LegalRevisionHistoryProps) {
  const headingId = useId();
  const newestFirst = revisions.toSorted(
    (left, right) => right.versionNumber - left.versionNumber,
  );

  return (
    <section
      aria-labelledby={headingId}
      className="mt-12 border-t border-border pt-8"
    >
      <h2 id={headingId} className="text-xl font-extrabold tracking-tight">
        {REVISION_HISTORY_TITLE}
      </h2>
      <ol className="mt-4 divide-y divide-border">
        {newestFirst.map(({ versionNumber, publishedAt, changeSummary }) => (
          <li key={versionNumber} className="flex flex-col gap-1 py-3">
            <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <PathLink
                href={legalRevisionPath(kind, versionNumber)}
                className={INLINE_LINK_CLASS_NAME}
              >
                {legalVersionLabel(versionNumber)}
              </PathLink>
              <span className="text-sm text-muted-foreground">
                <DateTime value={publishedAt} format="yearDate" />
              </span>
            </p>
            <p className="text-sm wrap-anywhere">{changeSummary}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
