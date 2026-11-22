import type { CommentActionDialogProps } from '../engagement/comment-action-types.ts';
import { ReportDialog } from './report-dialog.tsx';

export function CommentReportDialog({
  comment,
  open,
  onOpenChange,
  returnFocusRef,
}: CommentActionDialogProps) {
  return (
    <ReportDialog
      targetKind="comment"
      targetRef={comment.id}
      open={open}
      onOpenChange={onOpenChange}
      returnFocusRef={returnFocusRef}
    />
  );
}
