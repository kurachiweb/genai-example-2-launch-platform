import { useRef } from 'react';

import { DateTime } from '../../../lib/components/datetime/date-time.tsx';
import { MarkdownContent } from '../../../lib/components/markdown/markdown-content.tsx';
import { useMarkdownOptions } from '../../../lib/components/markdown/use-markdown-options.ts';
import { useRenderedMarkdown } from '../../../lib/components/markdown/use-rendered-markdown.ts';
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
  CHANGE_SUMMARY_LABEL,
  legalVersionTitle,
  PUBLISHED_AT_LABEL,
} from '../legal/legal-messages.ts';
import { LegalVersionNotice } from '../legal/legal-version-notice.tsx';
import { LEGAL_PAGE_HEADING_ID } from '../legal/use-legal-page-retry.ts';

export interface LegalVersionView {
  readonly publishedAt: string;
  readonly changeSummary: string;
  readonly body: string;
  readonly isLatest: boolean;
}

export type LegalVersionPageState =
  | { readonly status: 'pending' }
  | {
      readonly status: 'error';
      readonly error: unknown;
      readonly onRetry: () => void;
    }
  | { readonly status: 'success'; readonly version: LegalVersionView };

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
        return (
          <PublishedLegalVersion
            kind={kind}
            versionNumber={versionNumber}
            version={state.version}
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
        {legalVersionTitle(LEGAL_DOCUMENT_LABELS[kind], versionNumber)}
      </h1>
      {content}
    </div>
  );
}
