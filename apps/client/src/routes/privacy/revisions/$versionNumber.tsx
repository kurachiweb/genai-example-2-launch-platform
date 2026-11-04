import { useSuspenseQuery } from '@tanstack/react-query';
import {
  createFileRoute,
  type ErrorComponentProps,
  notFound,
} from '@tanstack/react-router';

import { parseVersionNumber } from '../../../../common-lib/legal/legal-documents.ts';
import { useLegalPageRetry } from '../../../components/legal/use-legal-page-retry.ts';
import { ErrorPage } from '../../../components/pages/error-page.tsx';
import { LegalVersionPage } from '../../../components/pages/legal-version-page.tsx';
import {
  legalDocumentVersionQueryOptions,
  loadLegalDocumentVersion,
  toLegalVersionView,
} from '../../../graphql/legal-documents.ts';
import { buildLegalVersionHead } from '../../../head/page-heads.ts';

export const Route = createFileRoute('/privacy/revisions/$versionNumber')({
  loader: loadLegalDocumentVersion('privacy'),
  head: ({ loaderData }) => buildLegalVersionHead('privacy', loaderData),
  pendingComponent: PrivacyVersionPending,
  errorComponent: PrivacyVersionError,
  component: PrivacyVersionRoute,
});

function PrivacyVersionRoute() {
  const { versionNumber } = Route.useLoaderData();
  const { data } = useSuspenseQuery(
    legalDocumentVersionQueryOptions('privacy', versionNumber),
  );
  const version = toLegalVersionView(data);
  if (version === undefined) {
    throw notFound();
  }
  return (
    <LegalVersionPage
      kind="privacy"
      versionNumber={versionNumber}
      state={{ status: 'success', version }}
    />
  );
}

// 版番号の形式違反はloaderがすぐに存在しないページにするため、読み込み中の表示を出さない
function PrivacyVersionPending() {
  const versionNumber = parseVersionNumber(Route.useParams().versionNumber);
  return versionNumber === undefined ? null : (
    <LegalVersionPage
      kind="privacy"
      versionNumber={versionNumber}
      state={{ status: 'pending' }}
    />
  );
}

// 版番号の形式違反はloaderが取得の前に存在しないページにするため、ここで版番号が無いのは想定外の失敗だけである
function PrivacyVersionError({ error }: ErrorComponentProps) {
  const retry = useLegalPageRetry();
  const versionNumber = parseVersionNumber(Route.useParams().versionNumber);
  return versionNumber === undefined ? (
    <ErrorPage />
  ) : (
    <LegalVersionPage
      kind="privacy"
      versionNumber={versionNumber}
      state={{ status: 'error', error, onRetry: retry }}
    />
  );
}
