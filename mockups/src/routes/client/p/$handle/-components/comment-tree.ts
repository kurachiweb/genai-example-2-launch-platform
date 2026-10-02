import type { CommentNode } from '../-model/comments';

// 返信ツリーを不変に更新するヘルパー

export function mapTree(
  nodes: CommentNode[],
  id: string,
  update: (node: CommentNode) => CommentNode,
): CommentNode[] {
  return nodes.map((node) =>
    node.id === id
      ? update(node)
      : { ...node, replies: mapTree(node.replies, id, update) },
  );
}

export function appendReply(
  nodes: CommentNode[],
  parentId: string,
  reply: CommentNode,
): CommentNode[] {
  return mapTree(nodes, parentId, (node) => ({
    ...node,
    replies: [...node.replies, reply],
  }));
}

export function editBody(
  nodes: CommentNode[],
  id: string,
  body: string,
): CommentNode[] {
  return mapTree(nodes, id, (node) => ({ ...node, body, edited: true }));
}

// 削除後も返信ツリーを保つため、ノードは残して置き換え表示にする(FR-COMNT-007)
export function markDeleted(nodes: CommentNode[], id: string): CommentNode[] {
  return mapTree(nodes, id, (node) => ({
    ...node,
    author: null,
    body: '',
    isOwn: false,
    isMaker: false,
  }));
}

export function countComments(nodes: CommentNode[]): number {
  return nodes.reduce((sum, node) => sum + 1 + countComments(node.replies), 0);
}
