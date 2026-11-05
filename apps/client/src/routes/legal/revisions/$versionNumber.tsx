import { createFileRoute } from '@tanstack/react-router';

import {
  legalVersionErrorComponent,
  legalVersionPendingComponent,
  legalVersionRouteComponent,
} from '../../../components/legal/legal-version-route-components.tsx';
import { loadLegalDocumentVersion } from '../../../graphql/legal-documents.ts';
import { buildLegalVersionHead } from '../../../head/page-heads.ts';

export const Route = createFileRoute('/legal/revisions/$versionNumber')({
  loader: loadLegalDocumentVersion('legal-notice'),
  head: ({ loaderData }) => buildLegalVersionHead('legal-notice', loaderData),
  pendingComponent: legalVersionPendingComponent('legal-notice'),
  errorComponent: legalVersionErrorComponent('legal-notice'),
  component: legalVersionRouteComponent('legal-notice'),
});
