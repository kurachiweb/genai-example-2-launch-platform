import { useRef } from 'react';

import { DateTime } from '../../../lib/components/datetime/date-time.tsx';
import { MarkdownContent } from '../../../lib/components/markdown/markdown-content.tsx';
import { useMarkdownOptions } from '../../../lib/components/markdown/use-markdown-options.ts';
import { useRenderedMarkdown } from '../../../lib/components/markdown/use-rendered-markdown.ts';
import { EmptyState } from '../../../lib/components/state/empty-state.tsx';
import { ErrorState } from '../../../lib/components/state/error-state.tsx';
import { LoadingSkeleton } from '../../../lib/components/state/loading-skeleton.tsx';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import {
  LEGAL_DOCUMENT_EXTERNAL_LINK_REL,
  LEGAL_DOCUMENT_LABELS,
  type LegalDocumentKind,
} from '../../../common-lib/legal/legal-documents.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import { CONTACT_HREF } from '../layout/site-links.ts';
import {
  LAST_REVISED_LABEL,
  LEGAL_DOCUMENT_PREPARING_MESSAGE,
} from '../legal/legal-messages.ts';
import {
  type LegalRevisionSummary,
  LegalRevisionHistory,
} from '../legal/legal-revision-history.tsx';
import { LEGAL_PAGE_HEADING_ID } from '../legal/use-legal-page-retry.ts';

export interface LegalLatestVersion {
  readonly versionNumber: number;
  readonly publishedAt: string;
  readonly body: string;
}

export interface LegalDocumentView {
  readonly latest: LegalLatestVersion | null;
  readonly revisions: readonly LegalRevisionSummary[];
}

export type LegalDocumentPageState =
  | { readonly status: 'pending' }
  | {
      readonly status: 'error';
      readonly error: unknown;
      readonly onRetry: () => void;
    }
  | { readonly status: 'success'; readonly document: LegalDocumentView };

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
  const headingRef = useRef<HTMLHeadingElement>(null);

  const content = (() => {
    switch (state.status) {
      case 'pending':
        return <LoadingSkeleton className="mt-8" />;
      case 'error':
        return (
          <ErrorState
            className="mt-8"
            message={errorMessageOf(
              state.error,
              CLIENT_PROFILE.contactAvailable,
            )}
            onRetry={() => {
              headingRef.current?.focus();
              state.onRetry();
            }}
            contactHref={CONTACT_HREF}
          />
        );
      case 'success':
        return state.document.latest === null ? (
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
        );
    }
  })();

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      {/* 再試行で消える再試行のボタンからフォーカスを<body>へ落とさないよう、移り先としてプログラムからだけフォーカスできるようにする */}
      <h1
        ref={headingRef}
        id={LEGAL_PAGE_HEADING_ID}
        tabIndex={-1}
        className="rounded-sm text-3xl font-extrabold tracking-tight sm:text-4xl"
      >
        {LEGAL_DOCUMENT_LABELS[kind]}
      </h1>
      {content}
    </div>
  );
}
