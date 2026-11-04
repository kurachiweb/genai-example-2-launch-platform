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

export const Route = createFileRoute('/legal/')({
  loader: loadLegalDocument('legal-notice'),
  head: ({ loaderData }) => buildLegalDocumentHead('legal-notice', loaderData),
  pendingComponent: LegalNoticePending,
  errorComponent: LegalNoticeError,
  component: LegalNoticeRoute,
});

function LegalNoticeRoute() {
  const { data } = useSuspenseQuery(legalDocumentQueryOptions('legal-notice'));
  return (
    <LegalDocumentPage
      kind="legal-notice"
      state={{ status: 'success', document: toLegalDocumentView(data) }}
    />
  );
}

function LegalNoticePending() {
  return (
    <LegalDocumentPage kind="legal-notice" state={{ status: 'pending' }} />
  );
}

function LegalNoticeError({ error }: ErrorComponentProps) {
  const retry = useLegalPageRetry();
  return (
    <LegalDocumentPage
      kind="legal-notice"
      state={{ status: 'error', error, onRetry: retry }}
    />
  );
}
