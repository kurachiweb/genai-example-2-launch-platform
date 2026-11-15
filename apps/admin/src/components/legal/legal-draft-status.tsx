import { DateTime } from '../../../lib/components/datetime/date-time.tsx';
import type { AdminLegalDraftView } from '../../graphql/admin-legal-documents.ts';
import {
  DELETED_ADMIN_LABEL,
  DRAFT_PRESENT_MESSAGE,
  DRAFT_SAVED_AT_LABEL,
  DRAFT_SAVED_BY_LABEL,
  NO_DRAFT_MESSAGE,
} from './legal-editor-messages.ts';

export interface LegalDraftStatusProps {
  readonly draft: AdminLegalDraftView | null;
}

const FRAME = 'rounded-lg border border-border bg-card p-4 text-sm';

export function LegalDraftStatus({ draft }: LegalDraftStatusProps) {
  if (draft === null) {
    return (
      <div className={FRAME}>
        <p className="text-muted-foreground">{NO_DRAFT_MESSAGE}</p>
      </div>
    );
  }
  return (
    <div className={FRAME}>
      <p className="font-semibold">{DRAFT_PRESENT_MESSAGE}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">{DRAFT_SAVED_AT_LABEL}</dt>
        <dd>
          <DateTime value={draft.savedAt} format="longDateTime" />
        </dd>
        <dt className="text-muted-foreground">{DRAFT_SAVED_BY_LABEL}</dt>
        <dd>{draft.savedBy.nickname ?? DELETED_ADMIN_LABEL}</dd>
      </dl>
    </div>
  );
}
