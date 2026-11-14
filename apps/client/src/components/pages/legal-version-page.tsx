import { DateTime } from '../../../lib/components/datetime/date-time.tsx';
import { MarkdownContent } from '../../../lib/components/markdown/markdown-content.tsx';
import { useMarkdownOptions } from '../../../lib/components/markdown/use-markdown-options.ts';
import { useRenderedMarkdown } from '../../../lib/components/markdown/use-rendered-markdown.ts';
import {
  LEGAL_DOCUMENT_EXTERNAL_LINK_REL,
  LEGAL_DOCUMENT_LABELS,
  type LegalDocumentKind,
  legalVersionTitle,
} from '../../../common-lib/legal/legal-documents.ts';
import {
  CHANGE_SUMMARY_LABEL,
  PUBLISHED_AT_LABEL,
} from '../legal/legal-messages.ts';
import {
  LegalPageFrame,
  type LegalPageState,
} from '../legal/legal-page-frame.tsx';
import { LegalVersionNotice } from '../legal/legal-version-notice.tsx';

export interface LegalVersionView {
  readonly publishedAt: string;
  readonly changeSummary: string;
  readonly body: string;
  readonly isLatest: boolean;
}

export type LegalVersionPageState = LegalPageState<{
  readonly version: LegalVersionView;
}>;

export interface LegalVersionPageProps {
  readonly kind: LegalDocumentKind;
  readonly versionNumber: number;
  readonly state: LegalVersionPageState;
}

interface PublishedLegalVersionProps {
  readonly kind: LegalDocumentKind;
  readonly versionNumber: number;
  readonly version: LegalVersionView;
}

function PublishedLegalVersion({
  kind,
  versionNumber,
  version,
}: PublishedLegalVersionProps) {
  const options = useMarkdownOptions({
    externalLinkRel: LEGAL_DOCUMENT_EXTERNAL_LINK_REL,
  });
  const rendered = useRenderedMarkdown(version.body, options);

  return (
    <>
      <LegalVersionNotice
        kind={kind}
        isLatest={version.isLatest}
        versionNumber={versionNumber}
      />
      <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{PUBLISHED_AT_LABEL}</dt>
        <dd>
          <DateTime value={version.publishedAt} format="yearDate" />
        </dd>
        <dt className="text-muted-foreground">{CHANGE_SUMMARY_LABEL}</dt>
        <dd className="wrap-anywhere">{version.changeSummary}</dd>
      </dl>
      <MarkdownContent rendered={rendered} className="mt-8" />
    </>
  );
}

export function LegalVersionPage({
  kind,
  versionNumber,
  state,
}: LegalVersionPageProps) {
  return (
    <LegalPageFrame
      title={legalVersionTitle(LEGAL_DOCUMENT_LABELS[kind], versionNumber)}
      state={state}
    >
      {state.status === 'success' && (
        <PublishedLegalVersion
          kind={kind}
          versionNumber={versionNumber}
          version={state.version}
        />
      )}
    </LegalPageFrame>
  );
}
