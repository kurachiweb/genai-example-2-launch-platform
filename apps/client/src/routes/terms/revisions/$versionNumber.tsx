import { createFileRoute } from '@tanstack/react-router';

import {
  legalVersionErrorComponent,
  legalVersionPendingComponent,
  legalVersionRouteComponent,
} from '../../../components/legal/legal-version-route-components.tsx';
import { loadLegalDocumentVersion } from '../../../graphql/legal-documents.ts';
import { buildLegalVersionHead } from '../../../head/page-heads.ts';

export const Route = createFileRoute('/terms/revisions/$versionNumber')({
  loader: loadLegalDocumentVersion('terms'),
  head: ({ loaderData }) => buildLegalVersionHead('terms', loaderData),
  pendingComponent: legalVersionPendingComponent('terms'),
  errorComponent: legalVersionErrorComponent('terms'),
  component: legalVersionRouteComponent('terms'),
});
