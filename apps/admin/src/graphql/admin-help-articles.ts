import type { QueryClient } from '@tanstack/react-query';
import { notFound } from '@tanstack/react-router';

import type { HelpArticleStatus } from '../../common-lib/help/help-article-status.ts';
import {
  type PinnedHelpGroups,
  splitPinnedGroups,
} from '../../common-lib/help/help-ordering.ts';
import { graphqlQueryOptions } from '../../lib/start/graphql/graphql-query-options.ts';
import { GraphQLClientError } from '../../lib/utilities/graphql/graphql-result.ts';
import { documentIdOf } from '../../lib/utilities/graphql/persisted-document.ts';
import type { MediaImageView } from '../../lib/utilities/media/picture-sources.ts';
import { adminHelpCategoriesQueryOptions } from './admin-help-categories.ts';
import {
  AdminHelpArticleDocument,
  type AdminHelpArticleFragment,
  AdminHelpArticleHandleAvailabilityDocument,
  type AdminHelpArticleHandleAvailabilityQuery,
  type AdminHelpArticleQuery,
  type AdminHelpArticleRowFragment,
  AdminHelpArticlesDocument,
  type AdminHelpArticlesQuery,
  AdminHelpCategoriesDocument,
  type HelpArticleHandleAvailability as GraphQLHelpArticleHandleAvailability,
  type HelpArticleStatus as GraphQLHelpArticleStatus,
} from './generated/graphql.ts';

export interface AdminHelpArticleAuthorView {
  readonly nickname: string;
  readonly title: string | null;
  readonly avatar: MediaImageView | null;
}

export interface AdminHelpArticleRowView {
  readonly id: string;
  readonly handle: string;
  readonly title: string;
  readonly categoryId: string;
  readonly categoryName: string;
  readonly status: HelpArticleStatus;
  readonly pinned: boolean;
  readonly sortOrder: number;
  readonly creatorAdminId: string;
  // nullは削除済みの管理者
  readonly creator: AdminHelpArticleAuthorView | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AdminHelpArticleView {
  readonly id: string;
  readonly handle: string;
  // 転送中の旧ハンドル。無ければnull
  readonly previousHandle: string | null;
  readonly title: string;
  readonly subtitle: string;
  // マークダウン
  readonly body: string;
  readonly categoryId: string;
  readonly categoryName: string;
  readonly status: HelpArticleStatus;
  readonly pinned: boolean;
  // nullは削除済みの管理者
  readonly creator: AdminHelpArticleAuthorView | null;
  // 編集の保存で送り返す版
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type HelpArticleHandleAvailability =
  | 'available'
  // 他の記事の旧ハンドルと一致し、保存するとその記事の旧URLの転送が無くなる
  | 'available-releases-previous'
  | 'unavailable'
  | 'invalid';

type HelpArticleAuthorFields = NonNullable<AdminHelpArticleFragment['creator']>;

const FROM_GRAPHQL_STATUS: Readonly<
  Record<GraphQLHelpArticleStatus, HelpArticleStatus>
> = Object.freeze({
  DRAFT: 'draft',
  PUBLISHED: 'published',
});

const TO_GRAPHQL_STATUS: Readonly<
  Record<HelpArticleStatus, GraphQLHelpArticleStatus>
> = Object.freeze({
  draft: 'DRAFT',
  published: 'PUBLISHED',
});

const FROM_GRAPHQL_HANDLE_AVAILABILITY: Readonly<
  Record<GraphQLHelpArticleHandleAvailability, HelpArticleHandleAvailability>
> = Object.freeze({
  AVAILABLE: 'available',
  AVAILABLE_RELEASES_PREVIOUS: 'available-releases-previous',
  UNAVAILABLE: 'unavailable',
  INVALID: 'invalid',
});

export const adminHelpArticlesQueryOptions = () =>
  graphqlQueryOptions(AdminHelpArticlesDocument, {});

export const adminHelpArticleQueryOptions = (id: string) =>
  graphqlQueryOptions(AdminHelpArticleDocument, { id });

// 作成中の記事は自分の現在・旧ハンドルを持たないため、記事のIDをnullにして新しい記事として判定させる
export const helpArticleHandleAvailabilityQueryOptions = (
  handle: string,
  articleId?: string,
) =>
  graphqlQueryOptions(AdminHelpArticleHandleAvailabilityDocument, {
    handle,
    articleId: articleId ?? null,
  });

export const toGraphQLHelpArticleStatus = (
  status: HelpArticleStatus,
): GraphQLHelpArticleStatus => TO_GRAPHQL_STATUS[status];

const toAuthor = (
  creator: HelpArticleAuthorFields | null,
): AdminHelpArticleAuthorView | null =>
  creator === null
    ? null
    : {
        nickname: creator.nickname,
        title: creator.title,
        avatar:
          creator.avatar === null
            ? null
            : {
                objectKey: creator.avatar.objectKey,
                fallbackFormat: creator.avatar.fallbackFormat,
                width: creator.avatar.width,
                height: creator.avatar.height,
              },
      };

const toAdminHelpArticleRow = (
  row: AdminHelpArticleRowFragment,
): AdminHelpArticleRowView => ({
  id: row.id,
  handle: row.handle,
  title: row.title,
  categoryId: row.categoryId,
  categoryName: row.categoryName,
  status: FROM_GRAPHQL_STATUS[row.status],
  pinned: row.pinned,
  sortOrder: row.sortOrder,
  creatorAdminId: row.creatorAdminId,
  creator: toAuthor(row.creator),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

// APIが返す更新日時の新しい順のまま並べる
export const toAdminHelpArticleRows = ({
  adminHelpArticles,
}: AdminHelpArticlesQuery): readonly AdminHelpArticleRowView[] =>
  adminHelpArticles.map(toAdminHelpArticleRow);

// 照会と作成・編集の応答は同じフラグメントの項目を選ぶため、フラグメントの型で受ける
export const toAdminHelpArticle = (
  article: AdminHelpArticleFragment,
): AdminHelpArticleView => ({
  id: article.id,
  handle: article.handle,
  previousHandle: article.previousHandle,
  title: article.title,
  subtitle: article.subtitle,
  body: article.body,
  categoryId: article.categoryId,
  categoryName: article.categoryName,
  status: FROM_GRAPHQL_STATUS[article.status],
  pinned: article.pinned,
  creator: toAuthor(article.creator),
  revision: article.revision,
  createdAt: article.createdAt,
  updatedAt: article.updatedAt,
});

export const toAdminHelpArticleDetail = ({
  adminHelpArticle,
}: AdminHelpArticleQuery): AdminHelpArticleView | null =>
  adminHelpArticle === null ? null : toAdminHelpArticle(adminHelpArticle);

export const toHelpArticleHandleAvailability = ({
  helpArticleHandleAvailability,
}: AdminHelpArticleHandleAvailabilityQuery): HelpArticleHandleAvailability =>
  FROM_GRAPHQL_HANDLE_AVAILABILITY[helpArticleHandleAvailability];

// 全件の照会は更新日時の新しい順のため、並べ替えの画面では選んだカテゴリの記事を利用者側と同じ規則で並べ直す
export const toHelpArticleOrderGroups = (
  rows: readonly AdminHelpArticleRowView[],
  categoryId: string,
): PinnedHelpGroups<AdminHelpArticleRowView> => {
  const groups = splitPinnedGroups(
    rows
      .filter((row) => row.categoryId === categoryId)
      .map((row) => ({
        id: row.id,
        categoryId: row.categoryId,
        pinned: row.pinned,
        sortOrder: row.sortOrder,
        createdAt: new Date(row.createdAt),
        row,
      })),
  );
  return {
    pinned: groups.pinned.map(({ row }) => row),
    others: groups.others.map(({ row }) => row),
  };
};

// 並べ替えの応答はそのカテゴリの記事だけのため、全件の取得の結果のうち同じ記事だけを置き換え、全件の更新日時の新しい順を保つ
export const mergeReorderedHelpArticles = (
  { adminHelpArticles }: AdminHelpArticlesQuery,
  reordered: readonly AdminHelpArticleRowFragment[],
): AdminHelpArticlesQuery => {
  const reorderedById = new Map(reordered.map((row) => [row.id, row]));
  return {
    adminHelpArticles: adminHelpArticles.map(
      (row) => reorderedById.get(row.id) ?? row,
    ),
  };
};

// 記事の作成・削除・カテゴリの変更はカテゴリの記事の件数を変え、ハンドルの保存は使用可否を変えるため、それらの取得もまとめて無効にする
export async function invalidateHelpArticleQueries(
  queryClient: QueryClient,
): Promise<void> {
  await Promise.all(
    [
      documentIdOf(AdminHelpArticlesDocument),
      documentIdOf(AdminHelpArticleDocument),
      documentIdOf(AdminHelpArticleHandleAvailabilityDocument),
      documentIdOf(AdminHelpCategoriesDocument),
    ].map((documentId) =>
      queryClient.invalidateQueries({ queryKey: [documentId] }),
    ),
  );
}

// 一覧と記事の並べ替えの画面は全件を読み、絞り込みとカテゴリの選択を画面の中で行うため、条件で取得し直さない。失敗は例外にせずキャッシュに残し、一覧・並びの位置に再試行とともに示す
export async function loadAdminHelpArticlesPage({
  context: { queryClient },
}: {
  readonly context: { readonly queryClient: QueryClient };
}): Promise<void> {
  await Promise.all([
    queryClient
      .query({ ...adminHelpArticlesQueryOptions(), staleTime: 'static' })
      .catch(() => undefined),
    queryClient
      .query({ ...adminHelpCategoriesQueryOptions(), staleTime: 'static' })
      .catch(() => undefined),
  ]);
}

// 作成の画面はカテゴリの選択肢が無ければフォームを描けないため、取得の失敗はルートのエラーの画面に任せる
export async function loadAdminHelpArticleNewPage({
  context: { queryClient },
}: {
  readonly context: { readonly queryClient: QueryClient };
}): Promise<void> {
  await queryClient.query({
    ...adminHelpCategoriesQueryOptions(),
    staleTime: 'static',
  });
}

const VALIDATION_ERROR = 'validation_error';

const ARTICLE_ID_FIELD = 'id';

// APIサーバーはIDの上限を超える形式の違反をnullではなく入力の検証の失敗で返すため、存在しないページとして扱う
const isMalformedArticleId = (error: unknown): boolean =>
  error instanceof GraphQLClientError &&
  error.code === VALIDATION_ERROR &&
  (error.details ?? []).some(({ field }) => field === ARTICLE_ID_FIELD);

// 編集は開いた時点の版を基準に競合を判定し、削除した後に戻る操作で開き直した記事も削除済みと示すため、記事はキャッシュの鮮度によらず毎回取得する。
// 削除済み(null)は画面に案内と一覧への導線を出すため例外にしない
export async function loadAdminHelpArticlePage({
  context: { queryClient },
  params,
}: {
  readonly context: { readonly queryClient: QueryClient };
  readonly params: { readonly articleId: string };
}): Promise<void> {
  await Promise.all([
    queryClient
      .query({
        ...adminHelpArticleQueryOptions(params.articleId),
        staleTime: 0,
      })
      .catch((error: unknown) => {
        if (isMalformedArticleId(error)) {
          throw notFound();
        }
        throw error;
      }),
    queryClient.query({
      ...adminHelpCategoriesQueryOptions(),
      staleTime: 'static',
    }),
  ]);
}

// 削除の後、一覧へ移る前に待つ。移った先の一覧に削除した記事を一瞬も出さないよう、表示していない一覧とカテゴリの一覧(記事の件数)も取得し直す。
// 表示中の編集画面の記事を取り直すと一覧へ移る前に削除済みの案内が見えるため、記事の1件は古い印だけを付け、次に開いた時に取得させる
export async function refreshHelpArticleQueriesAfterDelete(
  queryClient: QueryClient,
): Promise<void> {
  await Promise.all([
    ...[
      documentIdOf(AdminHelpArticlesDocument),
      documentIdOf(AdminHelpCategoriesDocument),
    ].map((documentId) =>
      queryClient.invalidateQueries({
        queryKey: [documentId],
        refetchType: 'all',
      }),
    ),
    ...[
      documentIdOf(AdminHelpArticleDocument),
      documentIdOf(AdminHelpArticleHandleAvailabilityDocument),
    ].map((documentId) =>
      queryClient.invalidateQueries({
        queryKey: [documentId],
        refetchType: 'none',
      }),
    ),
  ]);
}
