import { useMutation, useQueryClient } from '@tanstack/react-query';

import { notify } from '../../../lib/components/feedback/notify.ts';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import {
  launchCommentCountsKeyOf,
  launchCommentsQueryOptions,
  replaceProductRating,
} from '../../graphql/engagement.ts';
import {
  ClientDeleteCommentDocument,
  ClientPostCommentDocument,
  ClientUpdateCommentDocument,
  type LaunchCommentFragment,
  type ProductRatingFragment,
} from '../../graphql/generated/graphql.ts';
import type { CommentSubmission } from './comment-composer.tsx';
import {
  COMMENT_DELETED_MESSAGE,
  COMMENT_POSTED_MESSAGE,
  COMMENT_REPLIED_MESSAGE,
  COMMENT_UPDATED_MESSAGE,
  COMMENT_WITH_RATING_POSTED_MESSAGE,
} from './comment-messages.ts';
import {
  appendReply,
  type LaunchCommentsData,
  prependThread,
  replaceComment,
} from './comment-tree.ts';

export interface UseCommentMutationsOptions {
  readonly productId: string;
  readonly launchId: string;
  // ログイン中の閲覧者のID。未ログインの閲覧者は呼び出し側が投稿欄と操作を描かない
  readonly viewerId: string;
}

// どの操作も成功でキャッシュを更新して通知してから解決し、失敗はキャッシュを変えず通知もせずに拒否して、投稿欄やダイアログに理由の文言を示させる
export interface CommentMutations {
  readonly post: (submission: CommentSubmission) => Promise<void>;
  readonly reply: (
    parentId: string,
    submission: CommentSubmission,
  ) => Promise<void>;
  readonly update: (
    commentId: string,
    submission: CommentSubmission,
  ) => Promise<void>;
  readonly remove: (commentId: string, turnstileToken: string) => Promise<void>;
}

const contentOf = ({ body, rating }: CommentSubmission) => ({
  body,
  ...(rating === undefined ? {} : { rating }),
});

export function useCommentMutations({
  productId,
  launchId,
  viewerId,
}: UseCommentMutationsOptions): CommentMutations {
  const queryClient = useQueryClient();
  const postComment = useMutation(
    graphqlMutationOptions(ClientPostCommentDocument),
  );
  const updateComment = useMutation(
    graphqlMutationOptions(ClientUpdateCommentDocument),
  );
  const deleteComment = useMutation(
    graphqlMutationOptions(ClientDeleteCommentDocument),
  );

  const updateThreads = (
    update: (
      data: LaunchCommentsData | undefined,
      comment: LaunchCommentFragment,
    ) => LaunchCommentsData | undefined,
    comment: LaunchCommentFragment,
  ) => {
    queryClient.setQueryData<LaunchCommentsData>(
      launchCommentsQueryOptions(viewerId, productId, launchId).queryKey,
      (data) => update(data, comment),
    );
  };

  // 件数は他の利用者の投稿・削除や非公開化も反映した置き換え表示を除く数で、手元の操作だけでは数え直せないため、閲覧者を問わず無効にして取り直す
  const refreshCounts = () => {
    void queryClient.invalidateQueries({
      queryKey: launchCommentCountsKeyOf(productId),
    });
  };

  const applyRating = (rating: ProductRatingFragment | null) => {
    if (rating !== null) {
      replaceProductRating(queryClient, viewerId, rating);
    }
  };

  return {
    post: async (submission) => {
      const { comment, rating } = (
        await postComment.mutateAsync({
          variables: {
            input: { productId, launchId, ...contentOf(submission) },
          },
          turnstileToken: submission.turnstileToken,
        })
      ).postComment;
      updateThreads(prependThread, comment);
      applyRating(rating);
      refreshCounts();
      notify.success(
        submission.rating === undefined
          ? COMMENT_POSTED_MESSAGE
          : COMMENT_WITH_RATING_POSTED_MESSAGE,
      );
    },
    reply: async (parentId, submission) => {
      const { comment } = (
        await postComment.mutateAsync({
          variables: {
            input: { productId, launchId, parentId, ...contentOf(submission) },
          },
          turnstileToken: submission.turnstileToken,
        })
      ).postComment;
      updateThreads(appendReply, comment);
      refreshCounts();
      notify.success(COMMENT_REPLIED_MESSAGE);
    },
    update: async (commentId, submission) => {
      const { comment, rating } = (
        await updateComment.mutateAsync({
          variables: { input: { commentId, ...contentOf(submission) } },
          turnstileToken: submission.turnstileToken,
        })
      ).updateComment;
      updateThreads(replaceComment, comment);
      applyRating(rating);
      notify.success(COMMENT_UPDATED_MESSAGE);
    },
    remove: async (commentId, turnstileToken) => {
      const removed = (
        await deleteComment.mutateAsync({
          variables: { commentId },
          turnstileToken,
        })
      ).deleteComment;
      updateThreads(replaceComment, removed);
      refreshCounts();
      notify.success(COMMENT_DELETED_MESSAGE);
    },
  };
}
