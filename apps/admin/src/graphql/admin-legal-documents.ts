import type { QueryClient } from '@tanstack/react-query';
import { notFound } from '@tanstack/react-router';

import {
  isLegalDocumentKind,
  type LegalDocumentKind,
  parseVersionNumber,
} from '../../common-lib/legal/legal-documents.ts';
import { graphqlQueryOptions } from '../../lib/start/graphql/graphql-query-options.ts';
import {
  AdminLegalDocumentDocument,
  type AdminLegalDocumentQuery,
  AdminLegalDocumentsDocument,
  type AdminLegalDocumentsQuery,
  AdminLegalDocumentVersionDocument,
  type AdminLegalDocumentVersionQuery,
  type LegalDocumentKind as GraphQLLegalDocumentKind,
} from './generated/graphql.ts';

export interface LegalEditorView {
  readonly id: string;
  // 削除済みの管理者はnull
  readonly nickname: string | null;
}

export interface LegalDocumentSummaryView {
  readonly kind: LegalDocumentKind;
  // 未公開ならnull
  readonly latestVersionNumber: number | null;
  readonly latestPublishedAt: string | null;
  readonly hasDraft: boolean;
}

export interface AdminLegalDraftView {
  readonly body: string;
  readonly savedAt: string;
  readonly savedBy: LegalEditorView;
}

export interface AdminLegalRevisionView {
  readonly versionNumber: number;
  readonly publishedAt: string;
  readonly changeSummary: string;
  readonly publishedBy: LegalEditorView;
}

export interface AdminLegalDocumentView {
  readonly kind: LegalDocumentKind;
  // 保存・破棄・公開で送り返す状態の版
  readonly stateVersion: number;
  readonly latestBody: string | null;
  readonly draft: AdminLegalDraftView | null;
  // 新しい順
  readonly revisions: readonly AdminLegalRevisionView[];
}

export interface AdminLegalVersionView {
  readonly kind: LegalDocumentKind;
  readonly versionNumber: number;
  readonly publishedAt: string;
  readonly changeSummary: string;
  readonly body: string;
  readonly isLatest: boolean;
  readonly publishedBy: LegalEditorView;
}

export interface LegalDocumentLoaderData {
  readonly kind: LegalDocumentKind;
}

export interface LegalVersionLoaderData {
  readonly kind: LegalDocumentKind;
  readonly versionNumber: number;
}

// 保存・破棄・公開の応答も同じ項目を選ぶため、照会の結果の型で受ける
export type AdminLegalDocumentFields =
  AdminLegalDocumentQuery['adminLegalDocument'];

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

const FROM_GRAPHQL_LEGAL_DOCUMENT_KINDS: Readonly<
  Record<GraphQLLegalDocumentKind, LegalDocumentKind>
> = Object.freeze({
  TERMS: 'terms',
  PRIVACY: 'privacy',
  LEGAL_NOTICE: 'legal-notice',
});

export const toGraphQLLegalDocumentKind = (
  kind: LegalDocumentKind,
): GraphQLLegalDocumentKind => GRAPHQL_LEGAL_DOCUMENT_KINDS[kind];

const toEditor = ({ id, nickname }: LegalEditorView): LegalEditorView => ({
  id,
  nickname,
});

export const adminLegalDocumentsQueryOptions = () =>
  graphqlQueryOptions(AdminLegalDocumentsDocument, {});

export const adminLegalDocumentQueryOptions = (kind: LegalDocumentKind) =>
  graphqlQueryOptions(AdminLegalDocumentDocument, {
    kind: toGraphQLLegalDocumentKind(kind),
  });

export const adminLegalDocumentVersionQueryOptions = (
  kind: LegalDocumentKind,
  versionNumber: number,
) =>
  graphqlQueryOptions(AdminLegalDocumentVersionDocument, {
    kind: toGraphQLLegalDocumentKind(kind),
    versionNumber,
  });

export const toLegalDocumentSummaries = ({
  adminLegalDocuments,
}: AdminLegalDocumentsQuery): readonly LegalDocumentSummaryView[] =>
  adminLegalDocuments.map((summary) => ({
    kind: FROM_GRAPHQL_LEGAL_DOCUMENT_KINDS[summary.kind],
    latestVersionNumber: summary.latestVersionNumber,
    latestPublishedAt: summary.latestPublishedAt,
    hasDraft: summary.hasDraft,
  }));

export const toAdminLegalDocument = (
  document: AdminLegalDocumentFields,
): AdminLegalDocumentView => ({
  kind: FROM_GRAPHQL_LEGAL_DOCUMENT_KINDS[document.kind],
  stateVersion: document.stateVersion,
  latestBody: document.latestBody,
  draft:
    document.draft === null
      ? null
      : {
          body: document.draft.body,
          savedAt: document.draft.savedAt,
          savedBy: toEditor(document.draft.savedBy),
        },
  revisions: document.revisions.map((revision) => ({
    versionNumber: revision.versionNumber,
    publishedAt: revision.publishedAt,
    changeSummary: revision.changeSummary,
    publishedBy: toEditor(revision.publishedBy),
  })),
});

export const toAdminLegalVersion = ({
  adminLegalDocumentVersion: version,
}: AdminLegalDocumentVersionQuery): AdminLegalVersionView | undefined =>
  version === null
    ? undefined
    : {
        kind: FROM_GRAPHQL_LEGAL_DOCUMENT_KINDS[version.kind],
        versionNumber: version.versionNumber,
        publishedAt: version.publishedAt,
        changeSummary: version.changeSummary,
        body: version.body,
        isLatest: version.isLatest,
        publishedBy: toEditor(version.publishedBy),
      };

// 一覧の取得の失敗は一覧の場所で再試行できるよう、例外にせずキャッシュに残す
export async function loadAdminLegalDocuments({
  context,
}: {
  readonly context: LegalLoaderContext;
}): Promise<void> {
  await context.queryClient
    .query(adminLegalDocumentsQueryOptions())
    .catch(() => undefined);
}

const kindOf = (raw: string): LegalDocumentKind => {
  if (!isLegalDocumentKind(raw)) {
    throw notFound();
  }
  return raw;
};

// 文書が無ければ編集の画面を表示できないため、取得の失敗はそのまま投げてルートのエラーの画面に任せる
export async function loadAdminLegalDocument({
  params,
  context,
}: {
  readonly params: { readonly kind: string };
  readonly context: LegalLoaderContext;
}): Promise<LegalDocumentLoaderData> {
  const kind = kindOf(params.kind);
  await context.queryClient.query(adminLegalDocumentQueryOptions(kind));
  return { kind };
}

// 種類・版番号の形式違反と存在しない版の404の判定を、ルートのparams.parseに分けずにここへまとめる
export async function loadAdminLegalDocumentVersion({
  params,
  context,
}: {
  readonly params: { readonly kind: string; readonly versionNumber: string };
  readonly context: LegalLoaderContext;
}): Promise<LegalVersionLoaderData> {
  const kind = kindOf(params.kind);
  const versionNumber = parseVersionNumber(params.versionNumber);
  if (versionNumber === undefined) {
    throw notFound();
  }
  const data = await context.queryClient.query(
    adminLegalDocumentVersionQueryOptions(kind, versionNumber),
  );
  if (data.adminLegalDocumentVersion === null) {
    throw notFound();
  }
  return { kind, versionNumber };
}
