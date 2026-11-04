import { useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi, notFound } from '@tanstack/react-router';

import { LEGAL_DOCUMENT_LABELS } from '../../../common-lib/legal/legal-documents.ts';
import { AdminPageHeader } from '../../../lib/components/admin/admin-page-header.tsx';
import {
  adminLegalDocumentVersionQueryOptions,
  toAdminLegalVersion,
} from '../../graphql/admin-legal-documents.ts';
import { legalVersionTitle } from '../legal/legal-documents-messages.ts';
import { LegalVersionDetail } from '../legal/legal-version-detail.tsx';

const routeApi = getRouteApi(
  '/_authenticated/legal-documents/$kind/revisions/$versionNumber',
);

export function LegalDocumentVersionPage() {
  const { kind, versionNumber } = routeApi.useLoaderData();
  const { data: version } = useSuspenseQuery({
    ...adminLegalDocumentVersionQueryOptions(kind, versionNumber),
    select: toAdminLegalVersion,
  });
  // 公開した版は削除されないため、loaderが確かめた版が取得し直しで消えるのは版の照会の前提が崩れた時だけで、存在しないページとして扱う
  if (version === undefined) {
    throw notFound();
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <AdminPageHeader
        title={legalVersionTitle(LEGAL_DOCUMENT_LABELS[kind], versionNumber)}
      />
      <LegalVersionDetail version={version} />
    </div>
  );
}
