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

export const Route = createFileRoute('/legal/revisions/$versionNumber')({
  loader: loadLegalDocumentVersion('legal-notice'),
  head: ({ loaderData }) => buildLegalVersionHead('legal-notice', loaderData),
  pendingComponent: LegalNoticeVersionPending,
  errorComponent: LegalNoticeVersionError,
  component: LegalNoticeVersionRoute,
});

function LegalNoticeVersionRoute() {
  const { versionNumber } = Route.useLoaderData();
  const { data } = useSuspenseQuery(
    legalDocumentVersionQueryOptions('legal-notice', versionNumber),
  );
  const version = toLegalVersionView(data);
  if (version === undefined) {
    throw notFound();
  }
  return (
    <LegalVersionPage
      kind="legal-notice"
      versionNumber={versionNumber}
      state={{ status: 'success', version }}
    />
  );
}

// 版番号の形式違反はloaderがすぐに存在しないページにするため、読み込み中の表示を出さない
function LegalNoticeVersionPending() {
  const versionNumber = parseVersionNumber(Route.useParams().versionNumber);
  return versionNumber === undefined ? null : (
    <LegalVersionPage
      kind="legal-notice"
      versionNumber={versionNumber}
      state={{ status: 'pending' }}
    />
  );
}

// 版番号の形式違反はloaderが取得の前に存在しないページにするため、ここで版番号が無いのは想定外の失敗だけである
function LegalNoticeVersionError({ error }: ErrorComponentProps) {
  const retry = useLegalPageRetry();
  const versionNumber = parseVersionNumber(Route.useParams().versionNumber);
  return versionNumber === undefined ? (
    <ErrorPage />
  ) : (
    <LegalVersionPage
      kind="legal-notice"
      versionNumber={versionNumber}
      state={{ status: 'error', error, onRetry: retry }}
    />
  );
}
