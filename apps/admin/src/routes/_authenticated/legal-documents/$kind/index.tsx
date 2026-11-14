import { createFileRoute } from '@tanstack/react-router';

import { LegalDocumentEditorPage } from '../../../../components/pages/legal-document-editor-page.tsx';
import { loadAdminLegalDocument } from '../../../../graphql/admin-legal-documents.ts';
import { buildLegalDocumentEditorHead } from '../../../../head/page-heads.ts';

export const Route = createFileRoute('/_authenticated/legal-documents/$kind/')({
  loader: loadAdminLegalDocument,
  head: ({ loaderData }) => buildLegalDocumentEditorHead(loaderData),
  component: LegalDocumentEditorPage,
});
