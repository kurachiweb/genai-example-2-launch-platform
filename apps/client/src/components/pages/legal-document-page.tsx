import { DateTime } from '../../../lib/components/datetime/date-time.tsx';
import { MarkdownContent } from '../../../lib/components/markdown/markdown-content.tsx';
import { useMarkdownOptions } from '../../../lib/components/markdown/use-markdown-options.ts';
import { useRenderedMarkdown } from '../../../lib/components/markdown/use-rendered-markdown.ts';
import { EmptyState } from '../../../lib/components/state/empty-state.tsx';
import {
  LEGAL_DOCUMENT_EXTERNAL_LINK_REL,
  LEGAL_DOCUMENT_LABELS,
  type LegalDocumentKind,
} from '../../../common-lib/legal/legal-documents.ts';
import {
  LAST_REVISED_LABEL,
  LEGAL_DOCUMENT_PREPARING_MESSAGE,
} from '../legal/legal-messages.ts';
import {
  LegalPageFrame,
  type LegalPageState,
} from '../legal/legal-page-frame.tsx';
import {
  type LegalRevisionSummary,
  LegalRevisionHistory,
} from '../legal/legal-revision-history.tsx';

export interface LegalLatestVersion {
  readonly versionNumber: number;
  readonly publishedAt: string;
  readonly body: string;
}

export interface LegalDocumentView {
  readonly latest: LegalLatestVersion | null;
  readonly revisions: readonly LegalRevisionSummary[];
}

export type LegalDocumentPageState = LegalPageState<{
  readonly document: LegalDocumentView;
}>;

export interface LegalDocumentPageProps {
  readonly kind: LegalDocumentKind;
  readonly state: LegalDocumentPageState;
}

interface PublishedLegalDocumentProps {
  readonly kind: LegalDocumentKind;
  readonly latest: LegalLatestVersion;
  readonly revisions: readonly LegalRevisionSummary[];
}

function PublishedLegalDocument({
  kind,
  latest,
  revisions,
}: PublishedLegalDocumentProps) {
  const options = useMarkdownOptions({
    externalLinkRel: LEGAL_DOCUMENT_EXTERNAL_LINK_REL,
  });
  const rendered = useRenderedMarkdown(latest.body, options);

  return (
    <>
      <dl className="mt-3 flex gap-2 text-sm text-muted-foreground">
        <dt>{LAST_REVISED_LABEL}</dt>
        <dd>
          <DateTime value={latest.publishedAt} format="yearDate" />
        </dd>
      </dl>
      <MarkdownContent rendered={rendered} className="mt-8" />
      <LegalRevisionHistory kind={kind} revisions={revisions} />
    </>
  );
}

export function LegalDocumentPage({ kind, state }: LegalDocumentPageProps) {
  return (
    <LegalPageFrame title={LEGAL_DOCUMENT_LABELS[kind]} state={state}>
      {state.status === 'success' &&
        (state.document.latest === null ? (
          <EmptyState
            className="mt-8"
            title={LEGAL_DOCUMENT_PREPARING_MESSAGE}
          />
        ) : (
          <PublishedLegalDocument
            kind={kind}
            latest={state.document.latest}
            revisions={state.document.revisions}
          />
        ))}
    </LegalPageFrame>
  );
}
