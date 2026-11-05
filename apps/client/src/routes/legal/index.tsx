import { createFileRoute } from '@tanstack/react-router';

import {
  legalDocumentErrorComponent,
  legalDocumentPendingComponent,
  legalDocumentRouteComponent,
} from '../../components/legal/legal-document-route-components.tsx';
import { loadLegalDocument } from '../../graphql/legal-documents.ts';
import { buildLegalDocumentHead } from '../../head/page-heads.ts';

export const Route = createFileRoute('/legal/')({
  loader: loadLegalDocument('legal-notice'),
  head: ({ loaderData }) => buildLegalDocumentHead('legal-notice', loaderData),
  pendingComponent: legalDocumentPendingComponent('legal-notice'),
  errorComponent: legalDocumentErrorComponent('legal-notice'),
  component: legalDocumentRouteComponent('legal-notice'),
});
