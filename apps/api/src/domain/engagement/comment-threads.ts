import type {
  CommentDepth,
  CommentRow,
  CommentThreadRows,
} from '../../../lib/core/engagement/ports.ts';

export type CommentView =
  | {
      readonly kind: 'shown';
      readonly id: string;
      readonly parentId: string | null;
      readonly depth: CommentDepth;
      readonly authorUserId: string;
      readonly bodyMarkdown: string;
      readonly createdAt: Date;
      readonly edited: boolean;
      readonly byProductOwner: boolean;
      readonly viewerIsAuthor: boolean;
    }
  | {
      readonly kind: 'removed';
      readonly id: string;
      readonly parentId: string | null;
      readonly depth: CommentDepth;
    };

export interface CommentThreadView {
  readonly comment: CommentView;
  readonly replies: readonly CommentView[];
}

function toCommentView(
  row: CommentRow,
  ownerUserId: string,
  viewerUserId: string | undefined,
): CommentView {
  // 置き換え表示は非公開化・削除・匿名化・投稿者の利用停止の事情を区別させないため、投稿者に関わる判定を持たない
  if (row.kind === 'removed') {
    return {
      kind: 'removed',
      id: row.commentId,
      parentId: row.parentId,
      depth: row.depth,
    };
  }
  return {
    kind: 'shown',
    id: row.commentId,
    parentId: row.parentId,
    depth: row.depth,
    authorUserId: row.authorUserId,
    bodyMarkdown: row.bodyMarkdown,
    createdAt: row.createdAt,
    edited: row.edited,
    byProductOwner: row.authorUserId === ownerUserId,
    viewerIsAuthor: row.authorUserId === viewerUserId,
  };
}

export function toCommentViews(input: {
  readonly threads: readonly CommentThreadRows[];
  readonly ownerUserId: string;
  readonly viewerUserId: string | undefined;
}): readonly CommentThreadView[] {
  const { threads, ownerUserId, viewerUserId } = input;
  return threads.map(({ root, replies }) => ({
    comment: toCommentView(root, ownerUserId, viewerUserId),
    replies: replies.map((reply) =>
      toCommentView(reply, ownerUserId, viewerUserId),
    ),
  }));
}
