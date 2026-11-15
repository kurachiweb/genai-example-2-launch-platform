import { createFileRoute } from '@tanstack/react-router';

import { LEGAL_DOCUMENTS_TITLE } from '../../../components/legal/legal-documents-messages.ts';
import { LegalDocumentsPage } from '../../../components/pages/legal-documents-page.tsx';
import { loadAdminLegalDocuments } from '../../../graphql/admin-legal-documents.ts';
import { buildAdminPageHead } from '../../../head/page-heads.ts';

export const Route = createFileRoute('/_authenticated/legal-documents/')({
  loader: loadAdminLegalDocuments,
  head: () => buildAdminPageHead({ title: LEGAL_DOCUMENTS_TITLE }),
  component: LegalDocumentsPage,
});
