import type { CommentPage } from '../../../../application/engagement/comment-reader.ts';
import type { ProductRatingView } from '../../../../application/engagement/product-rating-view.ts';
import type { CommentView } from '../../../../domain/engagement/comment-threads.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import { userSummaryLoader } from '../profile/user-summary.ts';

export type LaunchCommentModel = CommentView;

export interface CommentMutationResultModel {
  readonly comment: LaunchCommentModel;
  readonly rating: ProductRatingView | null;
}

export interface LaunchCommentThreadModel {
  readonly comment: LaunchCommentModel;
  readonly replies: LaunchCommentModel[];
}

export interface LaunchCommentConnectionModel {
  readonly nodes: LaunchCommentThreadModel[];
  readonly pageInfo: {
    readonly hasNextPage: boolean;
    readonly endCursor: string | null;
  };
}

// カーソルはユースケースが符号化済みで返すため、そのまま渡す
export const toLaunchCommentConnection = (
  page: CommentPage,
): LaunchCommentConnectionModel => ({
  nodes: page.threads.map(({ comment, replies }) => ({
    comment,
    replies: [...replies],
  })),
  pageInfo: { hasNextPage: page.hasNextPage, endCursor: page.endCursor },
});

// 置き換え表示は事情を推測させないため、投稿者・本文・日時をnull、印とバッジを偽にそろえる
export const engagementViewResolvers = {
  LaunchComment: {
    state: (comment) => (comment.kind === 'shown' ? 'SHOWN' : 'REMOVED'),
    author: (comment, _args, context) =>
      comment.kind === 'shown'
        ? context.loaders.get(userSummaryLoader).load(comment.authorUserId)
        : null,
    body: (comment) => (comment.kind === 'shown' ? comment.bodyMarkdown : null),
    createdAt: (comment) =>
      comment.kind === 'shown' ? comment.createdAt : null,
    edited: (comment) => comment.kind === 'shown' && comment.edited,
    byProductOwner: (comment) =>
      comment.kind === 'shown' && comment.byProductOwner,
    viewerIsAuthor: (comment) =>
      comment.kind === 'shown' && comment.viewerIsAuthor,
  },
} satisfies Resolvers;
