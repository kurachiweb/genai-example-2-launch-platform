import type { QueryClient } from '@tanstack/react-query';
import { notFound } from '@tanstack/react-router';

import { graphqlQueryOptions } from '../../lib/start/graphql/graphql-query-options.ts';
import {
  LEGAL_DOCUMENT_PATHS,
  type LegalDocumentKind,
  parseVersionNumber,
} from '../../common-lib/legal/legal-documents.ts';
import type { LegalDocumentView } from '../components/pages/legal-document-page.tsx';
import type { LegalVersionView } from '../components/pages/legal-version-page.tsx';
import {
  ClientLegalDocumentDocument,
  type ClientLegalDocumentQuery,
  ClientLegalDocumentVersionDocument,
  type ClientLegalDocumentVersionQuery,
  type LegalDocumentKind as GraphQLLegalDocumentKind,
} from './generated/graphql.ts';

export interface LegalDocumentLoaderData {
  readonly preparing: boolean;
  readonly canonicalUrl: string;
}

export interface LegalVersionLoaderData {
  readonly versionNumber: number;
}

interface LegalLoaderContext {
  readonly queryClient: QueryClient;
}

const GRAPHQL_LEGAL_DOCUMENT_KINDS: Readonly<
  Record<LegalDocumentKind, GraphQLLegalDocumentKind>
> = Object.freeze({
  terms: 'TERMS',
  privacy: 'PRIVACY',
  'legal-notice': 'LEGAL_NOTICE',
});

export const legalDocumentQueryOptions = (kind: LegalDocumentKind) =>
  graphqlQueryOptions(ClientLegalDocumentDocument, {
    kind: GRAPHQL_LEGAL_DOCUMENT_KINDS[kind],
  });

export const legalDocumentVersionQueryOptions = (
  kind: LegalDocumentKind,
  versionNumber: number,
) =>
  graphqlQueryOptions(ClientLegalDocumentVersionDocument, {
    kind: GRAPHQL_LEGAL_DOCUMENT_KINDS[kind],
    versionNumber,
  });

export const toLegalDocumentView = ({
  legalDocument: { latest, revisions },
}: ClientLegalDocumentQuery): LegalDocumentView => ({
  latest:
    latest === null
      ? null
      : {
          versionNumber: latest.versionNumber,
          publishedAt: latest.publishedAt,
          body: latest.body,
        },
  revisions: revisions.map(({ versionNumber, publishedAt, changeSummary }) => ({
    versionNumber,
    publishedAt,
    changeSummary,
  })),
});

export const toLegalVersionView = ({
  legalDocumentVersion: version,
}: ClientLegalDocumentVersionQuery): LegalVersionView | undefined =>
  version === null
    ? undefined
    : {
        publishedAt: version.publishedAt,
        changeSummary: version.changeSummary,
        body: version.body,
        isLatest: version.isLatest,
      };

// 文書が無ければページを表示できないため、取得の失敗はエラーの画面(サーバー側の描画では状態コード500)にする。キャッシュにあれば取得し直さない
export function loadLegalDocument(kind: LegalDocumentKind) {
  return async ({
    context,
  }: {
    readonly context: LegalLoaderContext;
  }): Promise<LegalDocumentLoaderData> => {
    const data = await context.queryClient.query({
      ...legalDocumentQueryOptions(kind),
      staleTime: 'static',
    });
    return {
      preparing: data.legalDocument.latest === null,
      canonicalUrl: LEGAL_DOCUMENT_PATHS[kind],
    };
  };
}

// 版番号の形式違反と存在しない版の404の判定を、6つのルートのparams.parseに分けずにここへまとめる
export function loadLegalDocumentVersion(kind: LegalDocumentKind) {
  return async ({
    params,
    context,
  }: {
    readonly params: { readonly versionNumber: string };
    readonly context: LegalLoaderContext;
  }): Promise<LegalVersionLoaderData> => {
    const versionNumber = parseVersionNumber(params.versionNumber);
    if (versionNumber === undefined) {
      throw notFound();
    }
    const data = await context.queryClient.query({
      ...legalDocumentVersionQueryOptions(kind, versionNumber),
      staleTime: 'static',
    });
    if (data.legalDocumentVersion === null) {
      throw notFound();
    }
    return { versionNumber };
  };
}
