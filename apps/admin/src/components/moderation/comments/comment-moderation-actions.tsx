import { Button } from '../../../../lib/components/ui/button/button.tsx';
import type { AdminModerationCommentView } from '../../../graphql/admin-moderation-engagement.ts';
import { RoleGate } from '../../layout/role-gate.tsx';
import { useOpenModerationDialog } from '../shared/moderation-dialog-context.ts';
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

// 管理者が非公開化していないコメントに非公開化、非公開化したコメントに復元を、モデレーター以上にだけ示す。どちらも理由を必須とし、確認は一覧の単位のダイアログで開く
export function CommentModerationActions({
  comment,
}: CommentModerationActionsProps) {
  const openDialog = useOpenModerationDialog();
  const nickname = comment.author?.nickname ?? null;
  const kind: CommentActionKind =
    comment.state === 'hidden' ? 'unhide' : 'hide';
  const { operation, copyOf } = COMMENT_ACTIONS[kind];

  return (
    <RoleGate minimum="moderator">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={commentActionName(kind, nickname)}
        onClick={() => {
          openDialog({
            operation,
            targetId: comment.id,
            copy: copyOf(nickname),
          });
        }}
      >
        {COMMENT_ACTION_LABELS[kind]}
      </Button>
    </RoleGate>
  );
}
