import { getRouteApi } from '@tanstack/react-router';

import { LEGAL_DOCUMENT_LABELS } from '../../../common-lib/legal/legal-documents.ts';
import { AdminPageHeader } from '../../../lib/components/admin/admin-page-header.tsx';
import { legalVersionTitle } from '../legal/legal-documents-messages.ts';

const routeApi = getRouteApi(
  '/_authenticated/legal-documents/$kind/revisions/$versionNumber',
);

export function LegalDocumentVersionPage() {
  const { kind, versionNumber } = routeApi.useLoaderData();
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <AdminPageHeader
        title={legalVersionTitle(LEGAL_DOCUMENT_LABELS[kind], versionNumber)}
      />
    </div>
  );
}
