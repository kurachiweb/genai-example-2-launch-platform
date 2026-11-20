import { type RefObject, useState } from 'react';

import { Button } from '../../../../lib/components/ui/button/button.tsx';
import type { AdminModerationCommentView } from '../../../graphql/admin-moderation-engagement.ts';
import { RoleGate } from '../../layout/role-gate.tsx';
import { ModerationActionDialog } from '../shared/moderation-action-dialog.tsx';
import {
  COMMENT_ACTION_LABELS,
  commentActionName,
  hideCommentDialogCopy,
  type ModerationDialogCopy,
  unhideCommentDialogCopy,
} from '../shared/moderation-messages.ts';
import type { ModerationOperation } from '../shared/moderation-operations.ts';

export interface CommentModerationActionsProps {
  readonly comment: Pick<AdminModerationCommentView, 'id' | 'state' | 'author'>;
  // 確定の後の取り直しで押した操作が別の操作に替わる・一覧から消えるため、閉じた後のフォーカスの移り先
  readonly returnFocusRef: RefObject<HTMLElement | null>;
}

type CommentActionKind = keyof typeof COMMENT_ACTION_LABELS;

const COMMENT_ACTIONS: Readonly<
  Record<
    CommentActionKind,
    {
      readonly operation: ModerationOperation;
      readonly copyOf: (nickname: string | null) => ModerationDialogCopy;
    }
  >
> = Object.freeze({
  hide: Object.freeze({
    operation: 'comment.hide',
    copyOf: hideCommentDialogCopy,
  }),
  unhide: Object.freeze({
    operation: 'comment.unhide',
    copyOf: unhideCommentDialogCopy,
  }),
});

// 管理者が非公開化していないコメントに非公開化、非公開化したコメントに復元を、モデレーター以上にだけ示す。どちらも理由を必須とする
export function CommentModerationActions({
  comment,
  returnFocusRef,
}: CommentModerationActionsProps) {
  const nickname = comment.author?.nickname ?? null;
  const kind: CommentActionKind =
    comment.state === 'hidden' ? 'unhide' : 'hide';
  // 閉じる間に取り直した状態で題名や操作が替わらないよう、開いた時の操作を保つ
  const [opened, setOpened] = useState<CommentActionKind>(kind);
  const [open, setOpen] = useState(false);
  const [completed, setCompleted] = useState(false);
  const { operation, copyOf } = COMMENT_ACTIONS[opened];
  const copy = copyOf(nickname);

  return (
    <RoleGate minimum="moderator">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={commentActionName(kind, nickname)}
        onClick={() => {
          setOpened(kind);
          setCompleted(false);
          setOpen(true);
        }}
      >
        {COMMENT_ACTION_LABELS[kind]}
      </Button>
      <ModerationActionDialog
        open={open}
        onOpenChange={setOpen}
        operation={operation}
        targetId={comment.id}
        title={copy.title}
        description={copy.description}
        confirmLabel={copy.confirmLabel}
        onCompleted={() => {
          setCompleted(true);
        }}
        {...(completed ? { returnFocusRef } : {})}
      />
    </RoleGate>
  );
}
