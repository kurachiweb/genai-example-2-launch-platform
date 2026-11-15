import { createFileRoute } from '@tanstack/react-router';

import {
  legalDocumentErrorComponent,
  legalDocumentPendingComponent,
  legalDocumentRouteComponent,
} from '../../components/legal/legal-document-route-components.tsx';
import { loadLegalDocument } from '../../graphql/legal-documents.ts';
import { buildLegalDocumentHead } from '../../head/page-heads.ts';

export const Route = createFileRoute('/terms/')({
  loader: loadLegalDocument('terms'),
  head: ({ loaderData }) => buildLegalDocumentHead('terms', loaderData),
  pendingComponent: legalDocumentPendingComponent('terms'),
  errorComponent: legalDocumentErrorComponent('terms'),
  component: legalDocumentRouteComponent('terms'),
});
