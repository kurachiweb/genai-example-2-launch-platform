import { useSuspenseQuery } from '@tanstack/react-query';
import {
  type ErrorComponentProps,
  type ErrorRouteComponent,
  getRouteApi,
  notFound,
  type RouteComponent,
} from '@tanstack/react-router';

import {
  type LegalDocumentKind,
  parseVersionNumber,
} from '../../../common-lib/legal/legal-documents.ts';
import {
  legalDocumentVersionQueryOptions,
  toLegalVersionView,
} from '../../graphql/legal-documents.ts';
import { ErrorPage } from '../pages/error-page.tsx';
import { LegalVersionPage } from '../pages/legal-version-page.tsx';
import { useLegalPageRetry } from './use-legal-page-retry.ts';

const LEGAL_VERSION_ROUTE_IDS = Object.freeze({
  terms: '/terms/revisions/$versionNumber',
  privacy: '/privacy/revisions/$versionNumber',
  'legal-notice': '/legal/revisions/$versionNumber',
} as const satisfies Record<LegalDocumentKind, string>);

const legalVersionRouteApi = (kind: LegalDocumentKind) =>
  getRouteApi(LEGAL_VERSION_ROUTE_IDS[kind]);

export function legalVersionRouteComponent(
  kind: LegalDocumentKind,
): RouteComponent {
  const routeApi = legalVersionRouteApi(kind);
  return function LegalVersionRoute() {
    const { versionNumber } = routeApi.useLoaderData();
    const { data } = useSuspenseQuery(
      legalDocumentVersionQueryOptions(kind, versionNumber),
    );
    const version = toLegalVersionView(data);
    if (version === undefined) {
      throw notFound();
    }
    return (
      <LegalVersionPage
        kind={kind}
        versionNumber={versionNumber}
        state={{ status: 'success', version }}
      />
    );
  };
}

// 版番号の形式違反はloaderがすぐに存在しないページにするため、読み込み中の表示を出さない
export function legalVersionPendingComponent(
  kind: LegalDocumentKind,
): RouteComponent {
  const routeApi = legalVersionRouteApi(kind);
  return function LegalVersionPending() {
    const versionNumber = parseVersionNumber(
      routeApi.useParams().versionNumber,
    );
    return versionNumber === undefined ? null : (
      <LegalVersionPage
        kind={kind}
        versionNumber={versionNumber}
        state={{ status: 'pending' }}
      />
    );
  };
}

// 版番号の形式違反はloaderが取得の前に存在しないページにするため、ここで版番号が無いのは想定外の失敗だけである
export function legalVersionErrorComponent(
  kind: LegalDocumentKind,
): ErrorRouteComponent {
  const routeApi = legalVersionRouteApi(kind);
  return function LegalVersionError({ error }: ErrorComponentProps) {
    const retry = useLegalPageRetry();
    const versionNumber = parseVersionNumber(
      routeApi.useParams().versionNumber,
    );
    return versionNumber === undefined ? (
      <ErrorPage />
    ) : (
      <LegalVersionPage
        kind={kind}
        versionNumber={versionNumber}
        state={{ status: 'error', error, onRetry: retry }}
      />
    );
  };
}
