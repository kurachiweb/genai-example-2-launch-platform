import type { CommentPage } from '../../../../application/engagement/comment-reader.ts';
import type { ProductRatingView } from '../../../../application/engagement/product-rating-view.ts';
import type { CommentView } from '../../../../domain/engagement/comment-threads.ts';
import type { LoadedMedia, MediaLookupRequest } from '../media-lookup.ts';
import type {
  CommentList,
  CommentNode,
  RatingSummary,
} from '../schemas/engagement.ts';
import { type PublicApiOrigins, userSummaryOf } from './common-mappers.ts';

const commentsOf = (page: CommentPage): readonly CommentView[] =>
  page.threads.flatMap(({ comment, replies }) => [comment, ...replies]);

export const mediaRequestOfCommentPage = (
  page: CommentPage,
): MediaLookupRequest => ({
  fileIds: [],
  userIds: commentsOf(page).flatMap((comment) =>
    comment.kind === 'shown' ? [comment.authorUserId] : [],
  ),
});

// 置き換え表示は非公開化・削除・退会・停止の事情を推測させないため、投稿者・本文・日時をnull、編集済みを偽にそろえる。返信のツリー構造を保つため親のIDは返す
function toCommentNode(
  comment: CommentView,
  loaded: LoadedMedia,
  origins: PublicApiOrigins,
): CommentNode {
  if (comment.kind === 'removed') {
    return {
      id: comment.id,
      parent_id: comment.parentId,
      depth: comment.depth,
      removed: true,
      author: null,
      body_markdown: null,
      created_at: null,
      edited: false,
    };
  }
  return {
    id: comment.id,
    parent_id: comment.parentId,
    depth: comment.depth,
    removed: false,
    author: userSummaryOf(comment.authorUserId, loaded, origins),
    body_markdown: comment.bodyMarkdown,
    created_at: comment.createdAt.toISOString(),
    edited: comment.edited,
  };
}

export const toCommentListPage = (
  page: CommentPage,
  loaded: LoadedMedia,
  origins: PublicApiOrigins,
): CommentList => ({
  data: page.threads.map(({ comment, replies }) => ({
    ...toCommentNode(comment, loaded, origins),
    replies: replies.map((reply) => toCommentNode(reply, loaded, origins)),
  })),
  meta: { has_next: page.hasNextPage, next_cursor: page.endCursor },
});

export const toRatingSummary = (view: ProductRatingView): RatingSummary => ({
  average: view.average,
  count: view.count,
});
