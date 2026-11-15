import type { InfiniteData } from '@tanstack/react-query';

import type {
  ClientLaunchCommentsQuery,
  LaunchCommentFragment,
} from '../../graphql/generated/graphql.ts';

export type LaunchCommentsData = InfiniteData<
  ClientLaunchCommentsQuery,
  string | null
>;

type LaunchCommentsPage = ClientLaunchCommentsQuery;

export type LaunchCommentThread = NonNullable<
  ClientLaunchCommentsQuery['launchComments']
>['nodes'][number];

export interface CommentTreeNode {
  readonly comment: LaunchCommentFragment;
  readonly replies: readonly CommentTreeNode[];
}

// 返信の一覧はAPIサーバーが古い順に返すため、同じ親の子は一覧の順のまま並べる
export function buildTree(thread: LaunchCommentThread): CommentTreeNode {
  const nodeOf = (comment: LaunchCommentFragment): CommentTreeNode => ({
    comment,
    replies: thread.replies
      .filter(({ parentId }) => parentId === comment.id)
      .map(nodeOf),
  });
  return nodeOf(thread.comment);
}

const containsComment = (
  thread: LaunchCommentThread,
  commentId: string,
): boolean =>
  thread.comment.id === commentId ||
  thread.replies.some(({ id }) => id === commentId);

const containsAnywhere = (
  data: LaunchCommentsData,
  commentId: string,
): boolean =>
  data.pages.some(
    ({ launchComments }) =>
      launchComments?.nodes.some((thread) =>
        containsComment(thread, commentId),
      ) === true,
  );

// 変わらないページとスレッドは同じ参照のまま残し、変わったものだけを作り直す
const mapThreads = (
  data: LaunchCommentsData,
  update: (thread: LaunchCommentThread) => LaunchCommentThread,
): LaunchCommentsData => {
  const pages = data.pages.map((page): LaunchCommentsPage => {
    const connection = page.launchComments;
    if (connection === null) {
      return page;
    }
    const nodes = connection.nodes.map(update);
    return nodes.some((thread, index) => thread !== connection.nodes[index])
      ? { ...page, launchComments: { ...connection, nodes } }
      : page;
  });
  return pages.some((page, index) => page !== data.pages[index])
    ? { ...data, pages }
    : data;
};

// 新しいトップレベルは最も新しいため最初のページの先頭に置く。続きのページのカーソルは各ページの最後のスレッドで決まるため変わらない
export function prependThread(
  data: LaunchCommentsData | undefined,
  comment: LaunchCommentFragment,
): LaunchCommentsData | undefined {
  const [first, ...rest] = data?.pages ?? [];
  if (
    data === undefined ||
    first?.launchComments == null ||
    containsAnywhere(data, comment.id)
  ) {
    return data;
  }
  const thread: LaunchCommentThread = { comment, replies: [] };
  return {
    ...data,
    pages: [
      {
        ...first,
        launchComments: {
          ...first.launchComments,
          nodes: [thread, ...first.launchComments.nodes],
        },
      },
      ...rest,
    ],
  };
}

// 返信は最も新しいため、親を含むスレッドの平たい一覧の末尾に置く
export function appendReply(
  data: LaunchCommentsData | undefined,
  reply: LaunchCommentFragment,
): LaunchCommentsData | undefined {
  const { parentId } = reply;
  if (
    data === undefined ||
    parentId === null ||
    containsAnywhere(data, reply.id)
  ) {
    return data;
  }
  return mapThreads(data, (thread) =>
    containsComment(thread, parentId)
      ? { ...thread, replies: [...thread.replies, reply] }
      : thread,
  );
}

const mapComment = (
  data: LaunchCommentsData | undefined,
  commentId: string,
  update: (comment: LaunchCommentFragment) => LaunchCommentFragment,
): LaunchCommentsData | undefined => {
  if (data === undefined) {
    return data;
  }
  return mapThreads(data, (thread) => {
    if (thread.comment.id === commentId) {
      return { ...thread, comment: update(thread.comment) };
    }
    if (!thread.replies.some(({ id }) => id === commentId)) {
      return thread;
    }
    return {
      ...thread,
      replies: thread.replies.map((reply) =>
        reply.id === commentId ? update(reply) : reply,
      ),
    };
  });
};

export function replaceComment(
  data: LaunchCommentsData | undefined,
  comment: LaunchCommentFragment,
): LaunchCommentsData | undefined {
  return mapComment(data, comment.id, () => comment);
}

// 置き換え表示はAPIサーバーのREMOVEDと同じく作者・本文・日時を持たず、返信の木を保つためIDと親と階層だけを残す
export function markCommentRemoved(
  data: LaunchCommentsData | undefined,
  commentId: string,
): LaunchCommentsData | undefined {
  return mapComment(data, commentId, (comment) => ({
    ...comment,
    state: 'REMOVED',
    author: null,
    body: null,
    createdAt: null,
    edited: false,
    byProductOwner: false,
    viewerIsAuthor: false,
  }));
}
