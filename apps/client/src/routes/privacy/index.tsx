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

export const Route = createFileRoute('/privacy/')({
  loader: loadLegalDocument('privacy'),
  head: ({ loaderData }) => buildLegalDocumentHead('privacy', loaderData),
  pendingComponent: PrivacyPending,
  errorComponent: PrivacyError,
  component: PrivacyRoute,
});

function PrivacyRoute() {
  const { data } = useSuspenseQuery(legalDocumentQueryOptions('privacy'));
  return (
    <LegalDocumentPage
      kind="privacy"
      state={{ status: 'success', document: toLegalDocumentView(data) }}
    />
  );
}

function PrivacyPending() {
  return <LegalDocumentPage kind="privacy" state={{ status: 'pending' }} />;
}

function PrivacyError({ error }: ErrorComponentProps) {
  const retry = useLegalPageRetry();
  return (
    <LegalDocumentPage
      kind="privacy"
      state={{ status: 'error', error, onRetry: retry }}
    />
  );
}
