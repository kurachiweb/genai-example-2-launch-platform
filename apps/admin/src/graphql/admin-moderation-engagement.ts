import {
  type InfiniteData,
  infiniteQueryOptions,
  type QueryClient,
} from '@tanstack/react-query';

import {
  ADMIN_LIST_PAGE_SIZE,
  type ModerationAction,
} from '../../common-lib/moderation/moderation-actions.ts';
import type { AdminCommentState as AdminCommentStateValue } from '../../common-lib/moderation/moderation-labels.ts';
import type { RouterContext } from '../../lib/start/router-context.ts';
import { executeGraphQL } from '../../lib/start/graphql/execute-graphql.ts';
import { graphqlQueryOptions } from '../../lib/start/graphql/graphql-query-options.ts';
import { requireData } from '../../lib/utilities/graphql/graphql-result.ts';
import {
  documentIdOf,
  graphqlQueryKey,
} from '../../lib/utilities/graphql/persisted-document.ts';
import {
  type AdminModerationPage,
  type AdminUserSummaryView,
  type ModerationActionInput,
  type ModerationActionOptions,
  moderationActionOptions,
  type ModerationNoteView,
  toAdminUserSummary,
  toModerationNote,
  toModerationPage,
} from './admin-moderation-shared.ts';
import {
  type AdminCommentFilter,
  AdminCommentsDocument,
  type AdminCommentsQuery,
  type AdminCommentsQueryVariables,
  type AdminCommentState,
  AdminHideCommentDocument,
  AdminInvalidateRatingDocument,
  type AdminModerationRatingFragment,
  AdminProductRatingsDocument,
  type AdminProductRatingsQuery,
  type AdminProductRatingsQueryVariables,
  type AdminRatingFilter,
  AdminRatingsDocument,
  type AdminRatingsQuery,
  type AdminRatingsQueryVariables,
  type AdminRatingState,
  AdminRevalidateRatingDocument,
  AdminUnhideCommentDocument,
} from './generated/graphql.ts';

export type AdminRatingStateValue = 'valid' | 'invalidated';

export interface AdminModerationCommentFilter {
  readonly authorHandle?: string | undefined;
  readonly productHandle?: string | undefined;
  // 投稿日時はpostedFromを含みpostedBeforeを含まない
  readonly postedFrom?: string | undefined;
  readonly postedBefore?: string | undefined;
  readonly state?: AdminCommentStateValue | undefined;
}

export interface AdminModerationCommentListArgs extends AdminModerationCommentFilter {
  readonly after?: string | undefined;
}

export interface AdminModerationCommentView {
  readonly id: string;
  // マークダウンとして描画しない本文の先頭
  readonly excerpt: string;
  // nullは匿名化・退会済みの投稿者
  readonly author: AdminUserSummaryView | null;
  // nullは論理削除済みのプロダクト
  readonly productName: string | null;
  readonly productId: string;
  readonly launchId: string;
  // 0は取り消したローンチ、nullはローンチを読めない
  readonly launchNumber: number | null;
  readonly createdAt: string;
  readonly state: AdminCommentStateValue;
  readonly latestHide: ModerationNoteView | null;
}

export type AdminModerationCommentPage =
  AdminModerationPage<AdminModerationCommentView>;

export interface AdminModerationRatingFilter {
  readonly productHandle?: string | undefined;
  readonly raterHandle?: string | undefined;
  readonly state?: AdminRatingStateValue | undefined;
}

export interface AdminModerationRatingListArgs extends AdminModerationRatingFilter {
  readonly after?: string | undefined;
}

export interface AdminModerationRatingView {
  readonly id: string;
  // nullは退会済みの評価者
  readonly rater: AdminUserSummaryView | null;
  // nullは論理削除済みのプロダクト
  readonly productName: string | null;
  readonly productId: string;
  readonly score: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly state: AdminRatingStateValue;
  readonly latestInvalidation: ModerationNoteView | null;
}

export type AdminModerationRatingPage =
  AdminModerationPage<AdminModerationRatingView>;

export type AdminProductRatingsData = InfiniteData<
  AdminProductRatingsQuery,
  string | null
>;

export type CommentModerationAction = Extract<
  ModerationAction,
  `comment.${string}`
>;

export type RatingModerationAction = Extract<
  ModerationAction,
  `rating.${string}`
>;

type CommentNode = AdminCommentsQuery['adminComments']['nodes'][number];

const COMMENT_STATE_OF = Object.freeze({
  HIDDEN: 'hidden',
  DELETED: 'deleted',
  ANONYMIZED: 'anonymized',
  AUTHOR_UNAVAILABLE: 'author_unavailable',
  SHOWN: 'shown',
} as const satisfies Record<AdminCommentState, AdminCommentStateValue>);

const GRAPHQL_COMMENT_STATE_OF = Object.freeze({
  hidden: 'HIDDEN',
  deleted: 'DELETED',
  anonymized: 'ANONYMIZED',
  author_unavailable: 'AUTHOR_UNAVAILABLE',
  shown: 'SHOWN',
} as const satisfies Record<AdminCommentStateValue, AdminCommentState>);

const RATING_STATE_OF = Object.freeze({
  VALID: 'valid',
  INVALIDATED: 'invalidated',
} as const satisfies Record<AdminRatingState, AdminRatingStateValue>);

const GRAPHQL_RATING_STATE_OF = Object.freeze({
  valid: 'VALID',
  invalidated: 'INVALIDATED',
} as const satisfies Record<AdminRatingStateValue, AdminRatingState>);

const commentVariablesOf = ({
  authorHandle,
  productHandle,
  postedFrom,
  postedBefore,
  state,
  after,
}: AdminModerationCommentListArgs): AdminCommentsQueryVariables => {
  const filter: AdminCommentFilter = {
    ...(authorHandle !== undefined && { authorHandle }),
    ...(productHandle !== undefined && { productHandle }),
    ...(postedFrom !== undefined && { postedFrom }),
    ...(postedBefore !== undefined && { postedBefore }),
    ...(state !== undefined && { state: GRAPHQL_COMMENT_STATE_OF[state] }),
  };
  return {
    filter,
    first: ADMIN_LIST_PAGE_SIZE,
    ...(after !== undefined && { after }),
  };
};

const ratingVariablesOf = ({
  productHandle,
  raterHandle,
  state,
  after,
}: AdminModerationRatingListArgs): AdminRatingsQueryVariables => {
  const filter: AdminRatingFilter = {
    ...(productHandle !== undefined && { productHandle }),
    ...(raterHandle !== undefined && { raterHandle }),
    ...(state !== undefined && { state: GRAPHQL_RATING_STATE_OF[state] }),
  };
  return {
    filter,
    first: ADMIN_LIST_PAGE_SIZE,
    ...(after !== undefined && { after }),
  };
};

export const adminModerationCommentsQueryOptions = (
  args: AdminModerationCommentListArgs,
) => graphqlQueryOptions(AdminCommentsDocument, commentVariablesOf(args));

export const adminModerationRatingsQueryOptions = (
  args: AdminModerationRatingListArgs,
) => graphqlQueryOptions(AdminRatingsDocument, ratingVariablesOf(args));

const productRatingsFirstPageOf = (
  productId: string,
): AdminProductRatingsQueryVariables => ({
  productId,
  first: ADMIN_LIST_PAGE_SIZE,
});

// プロダクトの詳細の評価の一覧は続きを後ろに加えるため、続きのページは最後の項目のカーソルから読む
export const adminProductRatingsQueryOptions = (productId: string) =>
  infiniteQueryOptions({
    queryKey: graphqlQueryKey(
      AdminProductRatingsDocument,
      productRatingsFirstPageOf(productId),
    ),
    queryFn: async ({ pageParam, signal }) =>
      requireData(
        await executeGraphQL(
          AdminProductRatingsDocument,
          pageParam === null
            ? productRatingsFirstPageOf(productId)
            : { ...productRatingsFirstPageOf(productId), after: pageParam },
          { signal },
        ),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: ({
      adminProductRatings: { pageInfo },
    }: AdminProductRatingsQuery): string | undefined =>
      pageInfo.hasNextPage && pageInfo.endCursor !== null
        ? pageInfo.endCursor
        : undefined,
  });

const toComment = (node: CommentNode): AdminModerationCommentView => ({
  id: node.id,
  excerpt: node.excerpt,
  author: toAdminUserSummary(node.author),
  productName: node.productName,
  productId: node.productId,
  launchId: node.launchId,
  launchNumber: node.launchNumber,
  createdAt: node.createdAt,
  state: COMMENT_STATE_OF[node.state],
  latestHide: toModerationNote(node.latestHide),
});

const toRating = (
  node: AdminModerationRatingFragment,
): AdminModerationRatingView => ({
  id: node.id,
  rater: toAdminUserSummary(node.rater),
  productName: node.productName,
  productId: node.productId,
  score: node.score,
  createdAt: node.createdAt,
  updatedAt: node.updatedAt,
  state: RATING_STATE_OF[node.state],
  latestInvalidation: toModerationNote(node.latestInvalidation),
});

export const toAdminModerationCommentPage = ({
  adminComments,
}: AdminCommentsQuery): AdminModerationCommentPage =>
  toModerationPage(adminComments, toComment);

export const toAdminModerationRatingPage = ({
  adminRatings,
}: AdminRatingsQuery): AdminModerationRatingPage =>
  toModerationPage(adminRatings, toRating);

export const toAdminProductRatings = ({
  pages,
}: AdminProductRatingsData): readonly AdminModerationRatingView[] =>
  pages.flatMap(({ adminProductRatings }) =>
    adminProductRatings.nodes.map(toRating),
  );

const byIdAndReason = ({ targetId, reason }: ModerationActionInput) => ({
  id: targetId,
  reason,
});

const COMMENT_ACTION_OPTIONS: Readonly<
  Record<CommentModerationAction, ModerationActionOptions>
> = Object.freeze({
  'comment.hide': moderationActionOptions({
    document: AdminHideCommentDocument,
    variablesOf: byIdAndReason,
    outcomeOf: ({ hideComment }) => hideComment,
  }),
  'comment.unhide': moderationActionOptions({
    document: AdminUnhideCommentDocument,
    variablesOf: byIdAndReason,
    outcomeOf: ({ unhideComment }) => unhideComment,
  }),
});

const RATING_ACTION_OPTIONS: Readonly<
  Record<RatingModerationAction, ModerationActionOptions>
> = Object.freeze({
  'rating.invalidate': moderationActionOptions({
    document: AdminInvalidateRatingDocument,
    variablesOf: byIdAndReason,
    outcomeOf: ({ invalidateRating }) => invalidateRating,
  }),
  'rating.revalidate': moderationActionOptions({
    document: AdminRevalidateRatingDocument,
    variablesOf: byIdAndReason,
    outcomeOf: ({ revalidateRating }) => revalidateRating,
  }),
});

export const commentModerationActionOptions = (
  action: CommentModerationAction,
): ModerationActionOptions => COMMENT_ACTION_OPTIONS[action];

export const ratingModerationActionOptions = (
  action: RatingModerationAction,
): ModerationActionOptions => RATING_ACTION_OPTIONS[action];

export async function invalidateAdminModerationEngagementQueries(
  queryClient: QueryClient,
): Promise<void> {
  await Promise.all(
    [
      documentIdOf(AdminCommentsDocument),
      documentIdOf(AdminRatingsDocument),
      documentIdOf(AdminProductRatingsDocument),
    ].map((documentId) =>
      queryClient.invalidateQueries({ queryKey: [documentId] }),
    ),
  );
}

// 一覧の取得の失敗は一覧の中で再試行できるよう、例外にせずキャッシュに残す
export async function loadAdminModerationCommentsPage({
  context,
  deps,
}: {
  readonly context: Pick<RouterContext, 'queryClient'>;
  readonly deps: AdminModerationCommentListArgs;
}): Promise<void> {
  await context.queryClient
    .query(adminModerationCommentsQueryOptions(deps))
    .catch(() => undefined);
}

export async function loadAdminModerationRatingsPage({
  context,
  deps,
}: {
  readonly context: Pick<RouterContext, 'queryClient'>;
  readonly deps: AdminModerationRatingListArgs;
}): Promise<void> {
  await context.queryClient
    .query(adminModerationRatingsQueryOptions(deps))
    .catch(() => undefined);
}
