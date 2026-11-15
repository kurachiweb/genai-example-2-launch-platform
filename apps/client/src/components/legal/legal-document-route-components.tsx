import { useSuspenseQuery } from '@tanstack/react-query';
import type {
  ErrorComponentProps,
  ErrorRouteComponent,
  RouteComponent,
} from '@tanstack/react-router';

import type { LegalDocumentKind } from '../../../common-lib/legal/legal-documents.ts';
import {
  legalDocumentQueryOptions,
  toLegalDocumentView,
} from '../../graphql/legal-documents.ts';
import { LegalDocumentPage } from '../pages/legal-document-page.tsx';
import { useLegalPageRetry } from './use-legal-page-retry.ts';

export function legalDocumentRouteComponent(
  kind: LegalDocumentKind,
): RouteComponent {
  return function LegalDocumentRoute() {
    const { data } = useSuspenseQuery(legalDocumentQueryOptions(kind));
    return (
      <LegalDocumentPage
        kind={kind}
        state={{ status: 'success', document: toLegalDocumentView(data) }}
      />
    );
  };
}

export function legalDocumentPendingComponent(
  kind: LegalDocumentKind,
): RouteComponent {
  return function LegalDocumentPending() {
    return <LegalDocumentPage kind={kind} state={{ status: 'pending' }} />;
  };
}

export function legalDocumentErrorComponent(
  kind: LegalDocumentKind,
): ErrorRouteComponent {
  return function LegalDocumentError({ error }: ErrorComponentProps) {
    const retry = useLegalPageRetry();
    return (
      <LegalDocumentPage
        kind={kind}
        state={{ status: 'error', error, onRetry: retry }}
      />
    );
  };
}
