import { createFileRoute } from '@tanstack/react-router';

import { LegalDocumentVersionPage } from '../../../../../components/pages/legal-document-version-page.tsx';
import { loadAdminLegalDocumentVersion } from '../../../../../graphql/admin-legal-documents.ts';
import { buildLegalDocumentVersionHead } from '../../../../../head/page-heads.ts';

export const Route = createFileRoute(
  '/_authenticated/legal-documents/$kind/revisions/$versionNumber',
)({
  loader: loadAdminLegalDocumentVersion,
  head: ({ loaderData }) => buildLegalDocumentVersionHead(loaderData),
  component: LegalDocumentVersionPage,
});
