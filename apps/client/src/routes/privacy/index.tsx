import { createFileRoute } from '@tanstack/react-router';

import {
  legalDocumentErrorComponent,
  legalDocumentPendingComponent,
  legalDocumentRouteComponent,
} from '../../components/legal/legal-document-route-components.tsx';
import { loadLegalDocument } from '../../graphql/legal-documents.ts';
import { buildLegalDocumentHead } from '../../head/page-heads.ts';

export const Route = createFileRoute('/privacy/')({
  loader: loadLegalDocument('privacy'),
  head: ({ loaderData }) => buildLegalDocumentHead('privacy', loaderData),
  pendingComponent: legalDocumentPendingComponent('privacy'),
  errorComponent: legalDocumentErrorComponent('privacy'),
  component: legalDocumentRouteComponent('privacy'),
});
