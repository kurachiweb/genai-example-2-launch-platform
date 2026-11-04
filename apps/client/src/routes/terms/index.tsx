import { useSuspenseQuery } from '@tanstack/react-query';
import {
  createFileRoute,
  type ErrorComponentProps,
} from '@tanstack/react-router';

import { useLegalPageRetry } from '../../components/legal/use-legal-page-retry.ts';
import { LegalDocumentPage } from '../../components/pages/legal-document-page.tsx';
import {
  legalDocumentQueryOptions,
  loadLegalDocument,
  toLegalDocumentView,
} from '../../graphql/legal-documents.ts';
import { buildLegalDocumentHead } from '../../head/page-heads.ts';

export const Route = createFileRoute('/terms/')({
  loader: loadLegalDocument('terms'),
  head: ({ loaderData }) => buildLegalDocumentHead('terms', loaderData),
  pendingComponent: TermsPending,
  errorComponent: TermsError,
  component: TermsRoute,
});

function TermsRoute() {
  const { data } = useSuspenseQuery(legalDocumentQueryOptions('terms'));
  return (
    <LegalDocumentPage
      kind="terms"
      state={{ status: 'success', document: toLegalDocumentView(data) }}
    />
  );
}

function TermsPending() {
  return <LegalDocumentPage kind="terms" state={{ status: 'pending' }} />;
}

function TermsError({ error }: ErrorComponentProps) {
  const retry = useLegalPageRetry();
  return (
    <LegalDocumentPage
      kind="terms"
      state={{ status: 'error', error, onRetry: retry }}
    />
  );
}
