import { createFileRoute } from '@tanstack/react-router';

import {
  legalVersionErrorComponent,
  legalVersionPendingComponent,
  legalVersionRouteComponent,
} from '../../../components/legal/legal-version-route-components.tsx';
import { loadLegalDocumentVersion } from '../../../graphql/legal-documents.ts';
import { buildLegalVersionHead } from '../../../head/page-heads.ts';

export const Route = createFileRoute('/privacy/revisions/$versionNumber')({
  loader: loadLegalDocumentVersion('privacy'),
  head: ({ loaderData }) => buildLegalVersionHead('privacy', loaderData),
  pendingComponent: legalVersionPendingComponent('privacy'),
  errorComponent: legalVersionErrorComponent('privacy'),
  component: legalVersionRouteComponent('privacy'),
});
